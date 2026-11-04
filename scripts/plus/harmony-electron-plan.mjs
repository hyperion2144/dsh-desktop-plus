// 鸿蒙 Electron 构建的纯计划层：不碰文件系统，只做判定与拼接。
//
// 放在这里而不是塞进 build-harmony-electron.mjs 的原因：
// 覆盖层是否命中模板、签名块怎么注入、产物叫什么名字，这三件事都有「模板漂移就翻车」
// 的风险，必须能被单测直接按住（见 scripts/plus/test/harmony-electron-plan.test.mjs）。

/** 签名材料里 hvigor 认的字段。缺一个就签不出来，提前报错比等打包工具抛栈好读。 */
export const SIGNING_MATERIAL_KEYS = [
  'certpath',
  'keyAlias',
  'keyPassword',
  'profile',
  'signAlg',
  'storeFile',
  'storePassword',
]

/**
 * 覆盖层计划：overlay/ 下的每个相对路径都要在模板里找到同名目标。
 * 模板换结构时这里给出 missing 列表，调用方据此显式失败。
 */
export function planOverlay({ overlayFiles, templateFiles }) {
  const present = []
  const missing = []
  for (const rel of overlayFiles) {
    if (templateFiles.has(rel)) present.push(rel)
    else missing.push(rel)
  }
  return { present, missing }
}

/** 签名材料缺哪些字段。返回空数组才算能签。 */
export function missingMaterialKeys(material) {
  if (!material || typeof material !== 'object') return [...SIGNING_MATERIAL_KEYS]
  return SIGNING_MATERIAL_KEYS.filter((key) => {
    const value = material[key]
    return typeof value !== 'string' || value.length === 0
  })
}

const APP_BLOCK = /"app"\s*:\s*\{/
const SIGNING_BLOCK = /"signingConfigs"\s*:/
const PRODUCT_SIGNING = /"signingConfig"\s*:\s*"([^"]+)"/

/**
 * 把 signingConfigs 注入模板的 build-profile.json5。
 *
 * 为什么要拼字符串而不是 JSON.parse：模板的 build-profile.json5 是 JSON5
 * （有尾逗号），JSON.parse 直接吞不下去；而我们的注入点只有一处（"app": { 之后），
 * 拼一次比引一个 JSON5 依赖干净。
 *
 * 模板自己声明了 signingConfigs 时**不猜**，直接让调用方失败：那意味着模板换了形态，
 * 我们的注入逻辑该重写，而不是硬塞第二份。
 */
export function injectSigningConfigs(profileText, material) {
  const missing = missingMaterialKeys(material)
  if (missing.length > 0) {
    throw new Error('签名材料缺字段：' + missing.join(', '))
  }
  if (SIGNING_BLOCK.test(profileText)) {
    throw new Error('模板 build-profile.json5 已有 signingConfigs，注入点需要重新设计')
  }
  const anchor = APP_BLOCK.exec(profileText)
  if (!anchor) {
    throw new Error('模板 build-profile.json5 里找不到 "app": {，无法注入签名')
  }
  const product = PRODUCT_SIGNING.exec(profileText)
  if (!product) {
    throw new Error('模板 build-profile.json5 里找不到 products[].signingConfig')
  }
  const signingConfigs = [
    '  "signingConfigs": [',
    '    {',
    '      "name": ' + JSON.stringify(product[1]) + ',',
    '      "type": "HarmonyOS",',
    '      "material": ' + indent(JSON.stringify(material, null, 2), 6),
    '    },',
    '  ],',
    '',
    '',
  ].join('\n')
  const insertAt = anchor.index + anchor[0].length
  return profileText.slice(0, insertAt) + '\n' + signingConfigs + profileText.slice(insertAt)
}

function indent(block, spaces) {
  const pad = ' '.repeat(spaces)
  const lines = block.split('\n')
  const tail = lines.map((line, index) => (index === 0 ? line : pad + line))
  return tail.join('\n')
}

/** 产物文件名是不是未签名包。hvigor 的命名是 <module>-default-unsigned.hap。 */
export function isUnsignedHap(name) {
  return /-unsigned\.hap$/.test(name)
}

/**
 * 从产物目录里的文件名挑一个 HAP。
 * 优先已签名的包：同名情况下 signed 与 unsigned 可能同时在（release/debug 各一份），
 * 我们要的是"能装"的那份，所以 signed 先。
 */
export function pickHap(names) {
  const haps = names.filter((name) => name.endsWith('.hap'))
  if (haps.length === 0) return null
  const signed = haps.filter((name) => !isUnsignedHap(name)).sort()
  if (signed.length > 0) return signed[0]
  return haps.sort()[0]
}
