# Installer branding sources

`upstream/apps/desktop/installer/assets/brand*.png` 的替换源（欢迎页 lockup 位图：
鲸鱼标沿用官方图标，文字行换为 `deepseek` + `DESKTOP PLUS` 徽标）。

- 同步上游时由 `scripts/plus/hooks/0003-installer-plus-branding.patch` 重放（含 strings.nsh 的三处文案）。
- 同步上游时由 `scripts/plus/hooks/0003-installer-plus-branding.patch` 重放（含 strings.nsh 的三处文案）。
- 重新生成位图：`build_brand.py`（内置 Python 带 Pillow）把 `sources/` 里的官方徽章与词标裁切
  按**官方实测几何**合成四张输出，直接写进 `upstream/apps/desktop/installer/assets/`。
  槽位（`installer/theme.nsh` + `window-frame.cpp`）把位图拉满整个窗口宽（600px），
  因此 lockup 必须居中、内容宽 ≈34–43% 画布宽，绝不能铺满画布（否则安装器里占满全宽）。
- 重新生成补丁：以官方 blob 为基线（索引区暂存官方版本、工作区放我们的版本），
  `git diff --binary -- upstream/apps/desktop/installer > ../hooks/0003-installer-plus-branding.patch`，
  再用 `git apply --check` 验证可重放（现有补丁 5 个 diff 节：4 PNG + strings.nsh）。
