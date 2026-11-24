/**
 * 官方打包流水线与本仓库打包流水线的步骤对账（#145）。
 *
 * 我们的 `.github/workflows/build-desktop.yml` 是从零写的，与官方
 * `upstream/.github/workflows/macos-package.yml` / `windows-package.yml` 没有结构关系。
 * 官方新增一个打包步骤时，我们不会知道——CUA helper 就是这样漏掉的（#142 的
 * 「helper application is missing」）。
 *
 * 对账表 `scripts/plus/workflow-parity.json` 给每个官方步骤一个交代：
 *   - `ours` 指向我们流水线里承担同一职责的步骤名（名字可以不同）；
 *   - `ours: null` 表示我们刻意不做，`reason` 写明为什么。
 *
 * 门禁校验三件事，任何一条不满足就红：
 *   1. 官方每个步骤都在对账表里（官方新增步骤 → 强制我们判断）；
 *   2. `ours` 指向的步骤真的存在于我们的流水线（我们改名/删步骤 → 强制更新对账表）；
 *   3. 对账表里没有官方已删除的步骤（官方删步骤 → 强制清理）。
 *
 * 只比步骤名，不比步骤内部逻辑：内部逻辑变化由 `sync:upstream` 的补丁冲突兜住。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PARITY_FILE = join(ROOT, 'scripts', 'plus', 'workflow-parity.json')

/** 官方流水线 → 我们对应的流水线。 */
const PAIRS = [
  { official: 'upstream/.github/workflows/macos-package.yml', ours: '.github/workflows/build-desktop.yml', platform: 'macos' },
  { official: 'upstream/.github/workflows/windows-package.yml', ours: '.github/workflows/build-desktop.yml', platform: 'windows' },
]

/**
 * 从一份 workflow YAML 里取出所有 `- name:` 步骤名，去重保序。
 *
 * 不引 YAML 解析器：workflow 里的步骤名是单行标量，正则足够，且不会因为
 * 官方用了我们没装的 YAML 特性而失败。
 * @param {string} text - workflow 文件内容。
 * @returns {string[]} 步骤名，按首次出现顺序。
 */
export function stepNames(text) {
  const names = []
  for (const line of text.split('\n')) {
    const match = /^\s+- name:\s*(.+?)\s*$/u.exec(line)
    if (match === null) continue
    // 去掉 YAML 引号；`${{ }}` 表达式原样保留，两边写法一致才匹配得上。
    const name = match[1].replace(/^['"]|['"]$/gu, '')
    if (!names.includes(name)) names.push(name)
  }
  return names
}

/**
 * 校验对账表与两份流水线是否一致。
 * @param {object} input - 待校验的数据。
 * @param {{ platform: string, official: string[], ours: string[] }[]} input.pipelines - 每对流水线的步骤名。
 * @param {{ platform: string, step: string, ours: string | null, reason?: string }[]} input.parity - 对账表。
 * @returns {string[]} 失败描述；空数组表示一致。
 */
export function reconcile({ pipelines, parity }) {
  const failures = []
  for (const pipeline of pipelines) {
    const entries = parity.filter(entry => entry.platform === pipeline.platform)
    const covered = new Set(entries.map(entry => entry.step))
    // 1. 官方每个步骤都要有交代。
    for (const step of pipeline.official) {
      if (!covered.has(step)) {
        failures.push(`${pipeline.platform}: official step "${step}" is missing from scripts/plus/workflow-parity.json`)
      }
    }
    // 2. `ours` 必须真的存在；`ours: null` 必须带理由。
    for (const entry of entries) {
      if (entry.ours === null) {
        if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
          failures.push(`${pipeline.platform}: "${entry.step}" is exempted without a reason`)
        }
        continue
      }
      if (!pipeline.ours.includes(entry.ours)) {
        failures.push(`${pipeline.platform}: "${entry.step}" maps to "${entry.ours}", which is not a step in our workflow`)
      }
    }
    // 3. 官方已删除的步骤不该留在对账表里。
    for (const entry of entries) {
      if (!pipeline.official.includes(entry.step)) {
        failures.push(`${pipeline.platform}: "${entry.step}" is no longer an official step; drop it from scripts/plus/workflow-parity.json`)
      }
    }
  }
  for (const entry of parity) {
    if (!PAIRS.some(pair => pair.platform === entry.platform)) {
      failures.push(`parity: unknown platform "${entry.platform}"`)
    }
  }
  return failures
}

/**
 * 读对账表。
 * @returns {{ platform: string, step: string, ours: string | null, reason?: string }[]} 对账条目。
 */
export function loadParity() {
  const parsed = JSON.parse(readFileSync(PARITY_FILE, 'utf8'))
  if (!Array.isArray(parsed)) throw new Error('workflow-parity.json must be an array')
  return parsed
}

function main() {
  const pipelines = PAIRS.map(pair => ({
    platform: pair.platform,
    official: stepNames(readFileSync(join(ROOT, pair.official), 'utf8')),
    ours: stepNames(readFileSync(join(ROOT, pair.ours), 'utf8')),
  }))
  const failures = reconcile({ pipelines, parity: loadParity() })
  if (failures.length > 0) {
    for (const failure of failures) console.error(`workflow-parity: ${failure}`)
    console.error(`workflow-parity: ${String(failures.length)} difference(s); update scripts/plus/workflow-parity.json or port the step`)
    process.exit(1)
  }
  const total = pipelines.reduce((sum, pipeline) => sum + pipeline.official.length, 0)
  console.log(`workflow-parity: ${String(total)} official step(s) across ${String(pipelines.length)} pipeline(s) reconciled`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
