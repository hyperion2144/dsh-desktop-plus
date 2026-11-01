/**
 * 移动端版本号的事实源（ArkTS 端口）。
 *
 * ## 这是 node 侧事实源的 ArkTS 端口
 *
 * node 侧的事实源是 `scripts/plus/mobile-version.mjs`（票 #58）：plus 版本
 * `X.Y.Z[-<label>.<index>][.plus.N]` → 移动端安装版本号（Android `versionCode`、
 * iOS `CFBundleVersion`）的**确定性推导公式**。
 *
 * 壳在运行时要做两件事，都必须与发版侧同一套公式：
 *
 *  1. **比较**：按 SemVer 优先级判定「是不是更新的版本」——不依赖列表顺序；
 *  2. **推导**：把 plus 版本推成安装版本号（本壳用不到，但公式一并实现，便于对拍）。
 *
 * 两边是两次独立实现（node 侧给发版流水线用，ArkTS 侧给壳运行时用），
 * 因此**公式、字段上限、已知坑必须逐条对齐**，一致性由同一组数值锁定：
 * 见 `scripts/plus/test/mobile-version.vectors.json`——node / Kotlin / Swift /
 * ArkTS 四端跑的是同一份向量（`mobile/harmony/tools/parity-check.mjs` 是 ArkTS 那一端）。
 *
 * ## 对齐的规则
 *
 *  1. **含 `+` 的版本串一律拒绝**（SemVer §10）：构建元数据不参与比较，
 *     把 `.plus.N` 挪到 `+` 之后会让所有版本比较相等，更新判定会直接失效。
 *  2. **数字段不补零**（SemVer §9）：`02.2.2`、`0.2.2-alpha.02`、
 *     `0.2.2-alpha.2.plus.010` 都是非法版本。
 *  3. **字段有上限**：major/minor ≤ 9，patch / 预发布序号 / plus 计数 ≤ 99，
 *     预发布标签表 ≤ 9 个（标签序号 = 表下标）。
 *  4. **预发布标签必须在表里**：未知标签的构建号不可推导，不能猜。
 *
 * ## 两套解析：推导用严格版，比较用 SemVer 版
 *
 * - `parsePlusVersion`：严格版（上面四条规则），用于推导安装版本号；
 * - `compareVersions`：SemVer 版（核心三段无前导零 + 预发布标识符逐段比较），
 *   用于「是不是更新的版本」——与 node 侧 `comparePlusVersions`、Kotlin 侧
 *   `MobileVersion.compare` 同一套规则。
 *
 * 两者对同一串输入的判定不同是**已知且刻意**的：`0.2.2.plus.3`（正式版 base + plus 计数）
 * 推导得出（base = `0.2.2`），但不是合法 SemVer，比较时拒绝——node 与 Kotlin 同款。
 */

/** 预发布标签序号表：下标即标签序号（rank = index）。 */
export const PRERELEASE_LABELS: string[] = ['alpha', 'beta', 'rc'];

/** 正式版（无预发布段）的 level：必须大于任何预发布 level（8×100+99 = 899）。 */
export const STABLE_LEVEL: number = 999;

/** 预发布标签序号上限：level = 序号×100 + 预发布序号，必须留得下正式版的 999。 */
export const MAX_LABEL_RANK: number = 8;

/** 字段取值上限（与位权一起决定推导公式的容量）。 */
export const LIMIT_MAJOR: number = 9;
export const LIMIT_MINOR: number = 9;
export const LIMIT_PATCH: number = 99;
export const LIMIT_INDEX: number = 99;
export const LIMIT_PLUS: number = 99;

/** plus 版本解析结果：推导公式的字段。 */
export class ParsedVersion {
  major: number = 0;
  minor: number = 0;
  patch: number = 0;
  /** 预发布标签（正式版为空串）。 */
  label: string = '';
  /** 标签序号（正式版为 -1）。 */
  rank: number = -1;
  /** 预发布序号（正式版为 0）。 */
  index: number = 0;
  /** 是否带预发布段。 */
  hasPrerelease: boolean = false;
  /** plus 计数（`.plus.N` 的 N；没有 `.plus.N` 段时为 0）。 */
  plus: number = 0;
  /** 预发布层级（level）。 */
  level: number = STABLE_LEVEL;
}

/**
 * 解析 plus 版本 → 推导公式的字段。
 *
 * @param version `X.Y.Z[-<label>.<index>][.plus.N]`，允许带 `v` 前缀
 * @throws 版本串不合法时抛错（消息与 node 侧同款语义）
 */
export function parsePlusVersion(version: string): ParsedVersion {
  const trimmed = version.trim();
  if (trimmed.length === 0) {
    throw new Error('plus version must be a non-empty string');
  }
  const raw = trimmed.startsWith('v') ? trimmed.substring(1) : trimmed;
  if (raw.includes('+')) {
    throw new Error(
      `plus version ${version}: build metadata is not allowed — keep ".plus.N" in the prerelease part, ` +
      'moving it after "+" makes every build compare equal (SemVer §10)',
    );
  }

  // 拆 `.plus.N` 后缀：base 与 plus 计数分开（N 从 1 起）。
  let base: string = raw;
  let plus: number = 0;
  const plusAt: number = base.lastIndexOf('.plus.');
  if (plusAt >= 0) {
    const countText: string = base.substring(plusAt + '.plus.'.length);
    if (countText.length > 0 && isDigits(countText)) {
      plus = parseBoundedInteger(countText, 'plus count', LIMIT_PLUS);
      if (plus === 0) {
        throw new Error('plus count must be at least 1');
      }
      base = base.substring(0, plusAt);
    }
  }

  // 核心三段 + 预发布段。
  const dash: number = base.indexOf('-');
  const core: string = dash === -1 ? base : base.substring(0, dash);
  const prereleasePart: string = dash === -1 ? '' : base.substring(dash + 1);
  const coreParts: string[] = core.split('.');
  if (coreParts.length !== 3) {
    throw new Error(`unexpected upstream version: ${base}`);
  }
  const major: number = parseBoundedInteger(coreParts[0], 'major', LIMIT_MAJOR);
  const minor: number = parseBoundedInteger(coreParts[1], 'minor', LIMIT_MINOR);
  const patch: number = parseBoundedInteger(coreParts[2], 'patch', LIMIT_PATCH);

  const parsed: ParsedVersion = new ParsedVersion();
  parsed.major = major;
  parsed.minor = minor;
  parsed.patch = patch;
  if (prereleasePart.length > 0) {
    const pieces: string[] = prereleasePart.split('.');
    if (pieces.length !== 2 || !isPrereleaseLabel(pieces[0])) {
      throw new Error(`unsupported prerelease "${prereleasePart}": expected "<label>.<index>"`);
    }
    const label: string = pieces[0];
    const rank: number = PRERELEASE_LABELS.indexOf(label);
    if (rank === -1) {
      throw new Error(`unknown prerelease label "${label}": append it to PRERELEASE_LABELS`);
    }
    if (rank > MAX_LABEL_RANK) {
      throw new Error(`prerelease label "${label}" has rank ${rank}, past the supported range`);
    }
    parsed.label = label;
    parsed.rank = rank;
    parsed.index = parseBoundedInteger(pieces[1], 'prerelease index', LIMIT_INDEX);
    parsed.hasPrerelease = true;
  }
  parsed.plus = plus;
  parsed.level = parsed.hasPrerelease ? parsed.rank * 100 + parsed.index : STABLE_LEVEL;
  if (parsed.hasPrerelease && parsed.level >= STABLE_LEVEL) {
    throw new Error(`prerelease level ${parsed.level} collides with the stable level ${STABLE_LEVEL}`);
  }
  return parsed;
}

/**
 * 移动端安装版本号（Android versionCode）——从 plus 版本确定性推导，单调递增。
 */
export function mobileVersionCode(version: string): number {
  const parsed: ParsedVersion = parsePlusVersion(version);
  return parsed.major * 100000000 + parsed.minor * 10000000 + parsed.patch * 100000 +
    parsed.level * 100 + parsed.plus;
}

/**
 * 移动端安装版本号（iOS 形态：CFBundleVersion）——与 versionCode 同一套字段，同一单调序。
 */
export function mobileBundleVersion(version: string): string {
  const parsed: ParsedVersion = parsePlusVersion(version);
  const tail: number = parsed.patch * 100000 + parsed.level * 100 + parsed.plus;
  return `${parsed.major}.${parsed.minor}.${tail}`;
}

/**
 * 比较两个版本（SemVer 优先级）。
 *
 * 与 node 侧 `comparePlusVersions`、Kotlin 侧 `MobileVersion.compare` 同一套规则：
 * 先比主/次/补丁号，再比预发布段（标识符逐个比：数字标识符按数值比，数字 < 字母数字，
 * 前缀相同则长的更高），有预发布 < 无预发布；构建元数据不参与比较（且本实现直接拒绝 `+` 形态）。
 *
 * @throws 版本串不合法时抛错
 */
export function compareVersions(left: string, right: string): number {
  const l: SemVerParts = parseSemVer(left);
  const r: SemVerParts = parseSemVer(right);
  if (l.major !== r.major) {
    return l.major < r.major ? -1 : 1;
  }
  if (l.minor !== r.minor) {
    return l.minor < r.minor ? -1 : 1;
  }
  if (l.patch !== r.patch) {
    return l.patch < r.patch ? -1 : 1;
  }
  return comparePrerelease(l.prerelease, r.prerelease);
}

/** candidate 是否比 current 新（移动端更新判定用）。 */
export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

/** 一般 SemVer 版本（用于比较，不用于推导）。 */
class SemVerParts {
  major: number = 0;
  minor: number = 0;
  patch: number = 0;
  prerelease: string[] | null = null;
}

/**
 * 解析一般 SemVer 版本。
 *
 * 与 node `semver` 的 `valid()` 同一套合法性：核心三段无前导零、
 * 预发布标识符非空且数字标识符无前导零。
 */
function parseSemVer(version: string): SemVerParts {
  const trimmed: string = version.trim();
  if (trimmed.length === 0) {
    throw new Error('version must be a non-empty string');
  }
  const raw: string = trimmed.startsWith('v') ? trimmed.substring(1) : trimmed;
  if (raw.includes('+')) {
    throw new Error(
      `version ${version}: build metadata is not allowed — ".plus.N" must stay in the prerelease part, ` +
      'moving it after "+" makes every build compare equal (SemVer §10)',
    );
  }
  const dash: number = raw.indexOf('-');
  const core: string = dash === -1 ? raw : raw.substring(0, dash);
  const prereleasePart: string = dash === -1 ? '' : raw.substring(dash + 1);
  const coreParts: string[] = core.split('.');
  if (coreParts.length !== 3) {
    throw new Error(`not a valid SemVer version: ${version}`);
  }
  const parts: SemVerParts = new SemVerParts();
  parts.major = parseCoreField(coreParts[0], version);
  parts.minor = parseCoreField(coreParts[1], version);
  parts.patch = parseCoreField(coreParts[2], version);
  if (prereleasePart.length > 0) {
    const identifiers: string[] = prereleasePart.split('.');
    for (const identifier of identifiers) {
      if (!isPrereleaseLabel(identifier)) {
        throw new Error(`not a valid SemVer version: ${version}`);
      }
      if (isDigits(identifier) && identifier.length > 1 && identifier.startsWith('0')) {
        throw new Error(
          `version ${version}: prerelease identifier "${identifier}" must not have leading zeros (SemVer §9)`,
        );
      }
    }
    parts.prerelease = identifiers;
  }
  return parts;
}

/** 比较预发布段：null（无预发布）比任何预发布都高。 */
function comparePrerelease(left: string[] | null, right: string[] | null): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  const shared: number = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index++) {
    const result: number = compareIdentifier(left[index], right[index]);
    if (result !== 0) {
      return result;
    }
  }
  if (left.length === right.length) {
    return 0;
  }
  return left.length < right.length ? -1 : 1;
}

/** 比较单个预发布标识符（SemVer §11）。 */
function compareIdentifier(left: string, right: string): number {
  const leftNumeric: boolean = isDigits(left);
  const rightNumeric: boolean = isDigits(right);
  if (leftNumeric && rightNumeric) {
    // 数字标识符无前导零：位数先比，再字典序。
    if (left.length !== right.length) {
      return left.length < right.length ? -1 : 1;
    }
    if (left === right) {
      return 0;
    }
    return left < right ? -1 : 1;
  }
  if (leftNumeric) {
    return -1;
  }
  if (rightNumeric) {
    return 1;
  }
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** 解析核心段的一个数字字段（无前导零；不设上限——比较不看推导容量）。 */
function parseCoreField(text: string, version: string): number {
  if (text.length === 0 || !isDigits(text)) {
    throw new Error(`not a valid SemVer version: ${version}`);
  }
  if (text.length > 1 && text.startsWith('0')) {
    throw new Error(`version ${version}: core field "${text}" must not have leading zeros (SemVer §9)`);
  }
  return Number(text);
}

/** 解析无前导零的非负整数并做上界检查（只收 ASCII 数字，与 node 侧 `\d` 同义）。 */
function parseBoundedInteger(text: string, label: string, max: number): number {
  if (text.length === 0 || !isDigits(text)) {
    throw new Error(`${label} must be a non-negative integer: ${text}`);
  }
  if (text.length > 1 && text.startsWith('0')) {
    throw new Error(`${label} must not have leading zeros: ${text}`);
  }
  const value: number = Number(text);
  if (!isFinite(value) || value > max) {
    throw new Error(`${label} exceeds the supported range (max ${max}): ${text}`);
  }
  return value;
}

/** 是否是纯 ASCII 数字串。 */
function isDigits(text: string): boolean {
  if (text.length === 0) {
    return false;
  }
  for (let index = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    if (code < 48 || code > 57) {
      return false;
    }
  }
  return true;
}

/** 预发布标识符的合法字符（SemVer §9：只允许字母数字与连字符）。 */
function isPrereleaseLabel(text: string): boolean {
  if (text.length === 0) {
    return false;
  }
  for (let index = 0; index < text.length; index++) {
    const ch: string = text.charAt(index);
    const isLetter: boolean = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
    const isDigit: boolean = ch >= '0' && ch <= '9';
    if (!isLetter && !isDigit && ch !== '-') {
      return false;
    }
  }
  return true;
}
