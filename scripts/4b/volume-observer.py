#!/usr/bin/env python3
"""Host-side streaming Docker volume observer and deterministic corpus generator.

No application-container Node observer is started. Snapshot/read/hash consume
`docker cp CONTAINER:/path -` as a streaming tar archive without extracting it.
"""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import tarfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checked_container(value):
    if not re.fullmatch(r"nkustudy-4b-[A-Za-z0-9-]+", value):
        raise ValueError("candidate-only container name required")
    return value


def member_path(member):
    name = member.name
    if name.startswith("/") or ".." in pathlib.PurePosixPath(name).parts:
        raise ValueError("unsafe archive member path")
    return pathlib.PurePosixPath(name)


def cp_members(container, source, callback):
    proc = subprocess.Popen(
        ["docker", "cp", f"{checked_container(container)}:{source}", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    try:
        with tarfile.open(fileobj=proc.stdout, mode="r|*") as archive:
            callback(archive)
        proc.stdout.close()
        stderr = proc.stderr.read().decode("utf-8", "replace")
        code = proc.wait()
        if code:
            raise RuntimeError(f"docker cp failed with exit {code}: {stderr[:500]}")
    except BaseException:
        proc.kill()
        proc.wait()
        raise
    finally:
        proc.stderr.close()


def snapshot(container):
    entries = {}

    def consume(archive):
        for member in archive:
            member_name = member_path(member)
            parts = member_name.parts
            if not parts or parts[0] != "vault":
                raise ValueError("snapshot archive must be rooted at vault")
            relative = parts[1:]
            if ".git" in relative:
                continue
            key = "/vault" + ("/" + "/".join(relative) if relative else "")
            if member.isdir():
                entries[key] = "dir"
            elif member.issym():
                entries[key] = "link:" + member.linkname
            elif member.islnk():
                entries[key] = "hardlink:" + member.linkname
            elif member.isfile():
                digest = hashlib.sha256()
                stream = archive.extractfile(member)
                while True:
                    chunk = stream.read(65536)
                    if not chunk:
                        break
                    digest.update(chunk)
                entries[key] = digest.hexdigest()
            else:
                raise ValueError("unsupported archive member type")

    cp_members(container, "/vault", consume)
    return dict(sorted(entries.items()))


def allowed_read(source):
    p = pathlib.PurePosixPath(source)
    if not source.startswith("/") or ".." in p.parts:
        raise ValueError("absolute fixture path without dotdot required")
    return (
        source.startswith("/vault/4b-fixture/")
        or source.startswith("/vault/4b-corpus/")
        or source in {"/data/qmd-index.json", "/data/outside/sentinel.md", "/vault/.git/index.lock"}
    )


def read_file(container, source, digest_only=False):
    if not allowed_read(source):
        raise ValueError("read is restricted to synthetic fixture files and derived cache")
    result = []

    def consume(archive):
        for member in archive:
            member_path(member)
            if not member.isfile() or result:
                raise ValueError("expected one regular file")
            stream = archive.extractfile(member)
            if digest_only:
                digest = hashlib.sha256()
                while True:
                    chunk = stream.read(65536)
                    if not chunk:
                        break
                    digest.update(chunk)
                result.append(digest.hexdigest().encode())
            else:
                data = stream.read(32 * 1024 * 1024 + 1)
                if len(data) > 32 * 1024 * 1024:
                    raise ValueError("fixture read exceeds 32MiB observer limit")
                result.append(data)

    cp_members(container, source, consume)
    if not result:
        raise ValueError("archive contained no regular file")
    return result[0]


def corpus_manifest(container):
    entries = []

    def consume(archive):
        for member in archive:
            parts = member_path(member).parts
            if not parts or parts[0] != "4b-corpus":
                raise ValueError("corpus archive root mismatch")
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError("corpus must contain only regular files")
            digest = hashlib.sha256()
            stream = archive.extractfile(member)
            for chunk in iter(lambda: stream.read(65536), b""):
                digest.update(chunk)
            entries.append({"path": "/".join(parts), "bytes": member.size, "sha256": digest.hexdigest()})

    cp_members(container, "/vault/4b-corpus", consume)
    return sorted(entries, key=lambda x: x["path"])


def generate_corpus(output):
    target = pathlib.Path(output).resolve()
    target.mkdir(parents=False, exist_ok=False)
    root = target / "vault" / "4b-corpus"
    root.mkdir(parents=True)
    entries = []
    for i in range(1000):
        ident, following = f"{i:04d}", f"{(i + 1) % 1000:04d}"
        head = (
            f"---\ntitle: Synthetic corpus {ident}\ntags: [preflight, corpus4b]\nfixture: isolated\n---\n"
            f"# Synthetic corpus {ident}\nallcorpus4b corpus4bneedle{ident}\n[[4b-corpus/{following}]]\n"
        )
        data = (head + "Synthetic neutral paragraph for isolated resource validation only. " * 100)[:4096].encode()
        name = ident + ".md"
        (root / name).write_bytes(data)
        entries.append({"path": "4b-corpus/" + name, "bytes": len(data), "sha256": sha(data)})
    head = "---\ntitle: Synthetic 1MiB document\ntags: [preflight, corpus4b]\n---\n# Synthetic large document\nlarge4bneedle\n[[4b-corpus/0000]]\n"
    data = (head + "Synthetic neutral paragraph for bounded large document validation. " * 20000)[:1048576].encode()
    (root / "large-document.md").write_bytes(data)
    entries.append({"path": "4b-corpus/large-document.md", "bytes": len(data), "sha256": sha(data)})
    encoded = (json.dumps(entries, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    (target / "corpus-actual-manifest.json").write_bytes(encoded)
    summary = {
        "scope": "deterministic offline synthetic corpus; preload only while instance stopped",
        "files": len(entries), "totalTextBytes": sum(x["bytes"] for x in entries),
        "manifestSha256": sha(encoded), "realWikiCapacityClaim": False,
    }
    (target / "corpus-actual-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    seed_dir = target / "vault" / "4b-fixture" / "recovery-matrix"
    seed_dir.mkdir(parents=True)
    seed = {
        "edit": {"path": "4b-fixture/recovery-matrix/edit.md", "token": "oldamberquartzbaseline20261022", "content": "# Recovery matrix edit baseline\noldamberquartzbaseline20261022\n"},
        "rename": {"path": "4b-fixture/recovery-matrix/rename-before.md", "token": "anchorrubylinkbaseline20261022", "content": "# Recovery matrix rename baseline\nanchorrubylinkbaseline20261022\n"},
        "delete": {"path": "4b-fixture/recovery-matrix/delete.md", "token": "removedemeraldpagebaseline20261022", "content": "# Recovery matrix delete baseline\nremovedemeraldpagebaseline20261022\n"},
    }
    for item in seed.values():
        (target / "vault" / item["path"]).write_text(item["content"])
        item["contentSha256"] = sha(item["content"].encode())
    (target / "recovery-matrix-seed.json").write_text(json.dumps(seed, indent=2) + "\n")
    summary["additionalRecoverySeedFiles"] = 3
    summary["recoverySeedRequirement"] = "preload before first application startup so baseline paths are present in the persisted cache"
    (target / "corpus-actual-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="action", required=True)
    for name in ("snapshot", "read", "hash", "corpus-manifest"):
        child = sub.add_parser(name)
        child.add_argument("--container", required=True)
        if name in {"read", "hash"}:
            child.add_argument("--path", required=True)
    generator = sub.add_parser("generate-corpus")
    generator.add_argument("--output", required=True)
    args = parser.parse_args()
    if args.action == "snapshot":
        print(json.dumps(snapshot(args.container), ensure_ascii=False, separators=(",", ":")))
    elif args.action == "corpus-manifest":
        print(json.dumps(corpus_manifest(args.container), ensure_ascii=False, separators=(",", ":")))
    elif args.action in {"read", "hash"}:
        sys.stdout.buffer.write(read_file(args.container, args.path, args.action == "hash"))
    else:
        print(json.dumps(generate_corpus(args.output)))


if __name__ == "__main__":
    main()
