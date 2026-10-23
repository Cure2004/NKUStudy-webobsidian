#!/usr/bin/env python3
"""Dedicated, labelled Linux Docker volumes; never accepts arbitrary volume names."""
import hashlib
import json
import os
import pathlib
from manifest import require

INSTANCE_LABEL = 'org.nkustudy.4b.instance'
VOLUME_ROLE = 'org.nkustudy.4b.volume-role'


class VolumeStore:
    def __init__(self, state, name, image_id, docker):
        self.state, self.name, self.image_id, self.docker = pathlib.Path(state), name, image_id, docker
        self.binding = self.state / '.nkustudy-4b-volumes.json'
        self.generation = hashlib.sha256(str(self.state).encode()).hexdigest()

    def labels(self, role):
        return {INSTANCE_LABEL: self.name, VOLUME_ROLE: role,
                'org.nkustudy.4b.image-id': self.image_id,
                'org.nkustudy.4b.generation-sha256': self.generation}

    def volume_name(self, role):
        require(role in ('vault', 'data'), 'unknown volume role')
        return self.name + '-' + role

    def inspect(self, role):
        name = self.volume_name(role)
        value = json.loads(self.docker('volume', 'inspect', '--format', '{{json .}}', name))
        require(value.get('Name') == name and value.get('Driver') == value.get('Scope') == 'local', 'volume name/driver/scope mismatch')
        require(value.get('Options') in (None, {}) and value.get('Labels') == self.labels(role), 'volume labels/options mismatch')
        point = value.get('Mountpoint', '')
        path = pathlib.PurePosixPath(point)
        require(path.is_absolute() and '..' not in path.parts and point.endswith('/volumes/' + name + '/_data'), 'invalid named-volume mountpoint')
        return {key: value.get(key) for key in ('Name', 'Driver', 'Scope', 'Mountpoint', 'Options', 'Labels')}

    def ensure_absent(self):
        for role in ('vault', 'data'):
            require(self.docker('volume', 'inspect', self.volume_name(role), optional=True) is None,
                    'generation volume already exists; preserve it')

    def create(self):
        self.ensure_absent()
        values = {}
        for role in ('vault', 'data'):
            args = ['volume', 'create', '--driver', 'local']
            for key, value in self.labels(role).items(): args += ['--label', key + '=' + value]
            require(self.docker(*args, self.volume_name(role)) == self.volume_name(role), 'unexpected volume creation receipt')
            values[role] = self.inspect(role)
        self.binding.write_text(json.dumps({'format': 2, 'instance': self.name, 'image_id': self.image_id,
                                           'generation': self.generation, 'volumes': values}, indent=2) + '\n')
        self.binding.chmod(0o600)

    def check(self):
        require(self.binding.is_file() and not self.binding.is_symlink(), 'named-volume binding missing/symlinked')
        value = json.loads(self.binding.read_text())
        require(value.get('format') == 2 and value.get('instance') == self.name and value.get('image_id') == self.image_id and
                value.get('generation') == self.generation, 'named-volume generation mismatch')
        require(set(value.get('volumes', {})) == {'vault', 'data'}, 'named-volume roles mismatch')
        for role in ('vault', 'data'):
            require(value['volumes'][role] == self.inspect(role), 'named-volume mountpoint/ownership drift')
        return value['volumes']

    def mounts(self, readonly=False):
        return [item for role in ('vault', 'data') for item in
                ['--mount', 'type=volume,source=' + self.volume_name(role) + ',target=/' + role + (',readonly' if readonly else '')]]

    def helper(self, code, *, readonly=False, extra=None, arguments=None):
        self.check()
        return self.docker('run', '--rm', '--pull', 'never', '--platform', 'linux/amd64', '--network', 'none',
                           '--user', '0:0', '--read-only', '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'FOWNER',
                           '--cap-add', 'DAC_OVERRIDE', '--security-opt', 'no-new-privileges:true', '--memory', '128m',
                           '--memory-swap', '128m', '--cpus', '0.50', '--pids-limit', '32',
                           *self.mounts(readonly), *(extra or []), '--entrypoint', 'node', self.image_id, '-e', code,
                           *(arguments or []))

    def initialize(self):
        self.helper('const f=require("fs");for(const p of ["/vault","/data"]){if(f.readdirSync(p).length)throw Error("volume not empty");f.chownSync(p,1000,1000);f.chmodSync(p,0o700)}f.writeFileSync("/vault/4b-sentinel.md","# Isolated 4B fixture\\n\\nFixture sentinel: 4b-offline-package-only.\\n",{flag:"wx",mode:0o600});f.chownSync("/vault/4b-sentinel.md",1000,1000)')

    def password_ready(self):
        require(self.helper('const f=require("fs");const p="/data/settings.json";let s=f.lstatSync(p);if(!s.isFile()||s.isSymbolicLink())throw Error("settings invalid");const a=JSON.parse(f.readFileSync(p,"utf8")).auth;if(!a||!(a.userPasswordHash||a.passwordHash))throw Error("restored password absent");console.log("persisted-password-present")', readonly=True) == 'persisted-password-present', 'restored password required')

    def copy_tree(self, staging, *, restore=False):
        """Networkless helper reaches only this generation's verified volumes and a fresh staging dir."""
        staging = pathlib.Path(staging)
        require(staging.is_dir() and not staging.is_symlink() and ',' not in str(staging), 'unsafe snapshot staging directory')
        code = '''const f=require('fs');const restore=process.argv[1]==='restore';const uid=Number(process.argv[2]),gid=Number(process.argv[3]);
function copy(src,dst){const s=f.lstatSync(src);if(s.isSymbolicLink()||(!s.isDirectory()&&!s.isFile())||(s.isFile()&&s.nlink!==1))throw Error('unsafe snapshot source');if(s.isDirectory()){f.mkdirSync(dst,{mode:0o700});for(const n of f.readdirSync(src))copy(src+'/'+n,dst+'/'+n)}else{f.copyFileSync(src,dst,f.constants.COPYFILE_EXCL);f.chmodSync(dst,0o600)}f.chownSync(dst,restore?1000:uid,restore?1000:gid)}
for(const role of ['vault','data']){if(restore){if(f.readdirSync('/'+role).length)throw Error('restore volume not empty');for(const n of f.readdirSync('/staging/'+role))copy('/staging/'+role+'/'+n,'/'+role+'/'+n);f.chownSync('/'+role,1000,1000);f.chmodSync('/'+role,0o700)}else copy('/'+role,'/staging/'+role)}'''
        return self.helper(code, readonly=not restore,
                           extra=['--mount', 'type=bind,source=' + str(staging) + ',target=/staging' + (',readonly' if restore else '')],
                           arguments=['restore' if restore else 'backup', str(os.getuid()), str(os.getgid())])
