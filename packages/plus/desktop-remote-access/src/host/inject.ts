// 生成 --patch 注入清单（包名行），对齐既有 dsh-desktop-tauriapp 机制（设计 §1.3）。

/** 注入清单条目（插件 id + 包名）。 */
export interface InjectionEntry {
  id?: string
  name?: string
}

export function generateInjectionPatch(entries: InjectionEntry[] = []): string {
  const rows = entries
    .filter((e): e is { id: string; name: string } => !!(e && e.id && e.name))
    .map((e) => '    - id: ' + e.id + '\n      name: ' + e.name)
    .join('\n')
  return rows ? '- insert:\n' + rows + '\n' : ''
}
