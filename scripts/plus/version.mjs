// Plus 版本号生成：`X.Y.Z[-pre].plus.N`（票 #29 #4）。
// X.Y.Z[-pre] 取自 upstream/package.json；N 由「CHANGELOG 未发布段」与「同 base 已发布的
// 最大 N」推导，禁止手改——release workflow 用 `--check` 挡住不符的 tag。
//
// 用法：
//   node scripts/plus/version.mjs                    # 打印期望版本号（有未发布变更时）
//   node scripts/plus/version.mjs --check v0.2.1-plus.3   # 校验 tag；不符 exit 1 并给原因

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** 读 upstream 的 X.Y.Z[-pre]。 */
export function upstreamVersion() {
  const manifest = JSON.parse(readFileSync(join(root, 'upstream', 'package.json'), 'utf8'))
  return String(manifest.version)
}

/** CHANGELOG「未发布」段至少有一条变更。 */
export function hasUnreleasedChanges(changelogPath = join(root, 'CHANGELOG.md')) {
  return unreleasedNotes(changelogPath) !== ''
}

/** CHANGELOG 未发布段正文（release notes 用）；无该段或空段返回 ''。 */
export function unreleasedNotes(changelogPath = join(root, 'CHANGELOG.md')) {
  const text = readFileSync(changelogPath, 'utf8')
  const start = text.indexOf('## 未发布')
  if (start === -1) return ''
  const rest = text.slice(start + '## 未发布'.length)
  const next = rest.indexOf('\n## ')
  return rest.slice(0, next === -1 ? rest.length : next).trim()
}

/**
 * 期望的 plus 版本号：有未发布变更 → `base.plus.(latestN+1)`；没有 → 发版被拒（没有可发布的内容）。
 * @param base       upstream 的 X.Y.Z[-pre]
 * @param latestN    该 base 已发布过的最大 N（无则 0）
 * @param unreleased CHANGELOG 是否有未发布条目
 */
export function plusVersion(base, latestN, unreleased) {
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(base)) throw new Error(`unexpected upstream version: ${base}`)
  if (!unreleased) return null
  return `${base}.plus.${latestN + 1}`
}

/** 从 tag（v...）提取 base 与 N；非 plus tag 返回 null。 */
export function plusPatchOf(tag) {
  const match = /^v(.+)\.plus\.(\d+)$/.exec(tag)
  return match === null ? null : { base: match[1], n: Number(match[2]) }
}

/** 同 base 已发布过的最大 N（本地 tag 里查；无则 0）。excludeTagName 排除正在校验/构建的那一枚：发版 checkout 时 tag 已经存在，不能把自己当成已发布。 */
export function latestPublishedN(base, excludeTagName) {
  const tags = execFileSync('git', ['tag', '--list', `v${base}.plus.*`], { encoding: 'utf8' })
  return tags.split('\n').reduce((max, tag) => {
    const name = tag.trim()
    if (name === '' || name === excludeTagName) return max
    const patch = plusPatchOf(name)
    return patch === null ? max : Math.max(max, patch.n)
  }, 0)
}
/** HEAD 恰好停在某枚 tag 上（发版 checkout）时的 tag 名；否则 null。 */
function exactTagOnHead() {
  try {
    return execFileSync('git', ['describe', '--exact-match', '--tags', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}
/** 解析一个 rev 到 commit SHA；解析失败返回 null。 */
function revParse(rev) {
  try {
    return execFileSync('git', ['rev-parse', '--verify', rev], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}


const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const argv = process.argv.slice(2)
  // --print：打包/预览构建要的版本号（不校验 tag、也不要求 CHANGELOG 有未发布条目）：
  // 口径仍然是官方版本号 + plus.N，N 取该 base 已发布的最大 N + 1。
  if (argv.includes('--print')) {
    console.log(`${upstreamVersion()}.plus.${latestPublishedN(upstreamVersion(), exactTagOnHead()) + 1}`)
    process.exit(0)
  }
  const checkIndex = argv.indexOf('--check')
  const base = upstreamVersion()
  if (checkIndex !== -1) {
    const tag = argv[checkIndex + 1]
    const expected = plusVersion(base, latestPublishedN(base, tag), hasUnreleasedChanges())
    if (expected === null) {
      // 重发放行：tag 指向当前 HEAD（main 已含该版本全部内容）且版本号正确时，
      // 未发布段为空是重发的正常形态（产物修复重发不新增变更）。
      const patch = plusPatchOf(tag)
      const head = revParse('HEAD')
      const tagHead = revParse(`${tag}^{commit}`)
      if (patch !== null && head !== null && tagHead === head && patch.n === latestPublishedN(base, tag) + 1) {
        console.log(`ok ${tag} (republish at HEAD)`)
        process.exit(0)
      }
      console.error('refusing to release: CHANGELOG has no unreleased changes')
      process.exit(1)
    }
    if (tag !== `v${expected}`) {
      console.error(`tag ${tag} does not match expected v${expected}`)
      process.exit(1)
    }
    console.log(`ok ${tag}`)
  } else {
    const expected = plusVersion(base, latestPublishedN(base), hasUnreleasedChanges())
    if (expected === null) {
      console.error('no unreleased changes to release')
      process.exit(1)
    }
    console.log(expected)
  }
}
