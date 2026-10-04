/**
 * 提交信息模板（对齐 QUT WiKi 仓库的 CI 提交规范）。
 *
 * 规范：`<中文前缀>: <自定义描述>`，例如「新增: 添加市北校区建筑与设施信息」。
 * 前缀与冒号之间使用英文冒号 + 一个空格，描述为中文且不少于 2 个字符。
 * 该前缀列表与 `.github/workflows/pr-check.yml` 中的校验保持一致。
 */

/** 允许的中文提交前缀（与 Wiki 仓库 CI 校验一致）。 */
export const COMMIT_PREFIXES = [
  '新增',
  '修订',
  '优化',
  '修复',
  '更新',
  '下线',
  '移除',
  '调整',
  '重构',
  '补充',
  '回滚',
  '文档',
  '测试',
  '构建',
  '样式',
  '安全',
] as const;

export type CommitPrefix = (typeof COMMIT_PREFIXES)[number];

export interface CommitTemplateInput {
  prefix: string;
  description: string;
}

export class CommitTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommitTemplateError';
  }
}

/**
 * 校验并拼装提交信息。
 * @throws CommitTemplateError 当前缀不在允许列表或描述过短时。
 */
export function buildCommitMessage(input: CommitTemplateInput): string {
  const prefix = String(input.prefix ?? '').trim();
  const description = String(input.description ?? '').trim();
  if (!COMMIT_PREFIXES.includes(prefix as CommitPrefix)) {
    throw new CommitTemplateError(
      `提交前缀不合法：${prefix || '(空)'}。可用前缀：${COMMIT_PREFIXES.join(' / ')}`,
    );
  }
  if (description.length < 2) {
    throw new CommitTemplateError('提交描述至少需要 2 个字符');
  }
  if (description.includes('\n')) {
    throw new CommitTemplateError('提交描述不能包含换行');
  }
  return `${prefix}: ${description}`;
}

/** 校验任意一条提交信息是否符合「中文前缀: 描述」规范。 */
export function isValidCommitMessage(message: string): boolean {
  const m = String(message ?? '').match(/^([^：:]+)[：:]\s*(.+)$/);
  if (!m) return false;
  return COMMIT_PREFIXES.includes(m[1].trim() as CommitPrefix) && m[2].trim().length >= 2;
}
