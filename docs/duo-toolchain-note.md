# Duo 工具链备注（1.21.0 P0 · SPEC-DUO-P0 T10）

- **deployment target** 仍为 **iOS 16.4** / macOS 13.3（见 `build/os-floor.config.js`）。
- **目标编包 SDK** 为 **iOS 27.1**（用户 2026-10-23 已批安装）。deployment 下限与编包 SDK 是两件事——**勿擅自把 IPHONEOS_DEPLOYMENT_TARGET 抬到 27.1**。
- 装 27.1 完成前可按 SPEC §3.2 过渡轨推几何/守卫；竖向系统栏实物、letterbox 最终证明、ReservedRegion 真几何属 `need-27.1` / `need-Duo-sim|device`。
- 本备注只做文档指针；不改 `project.pbxproj` 的 SDK 选择。
