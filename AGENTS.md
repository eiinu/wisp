# 仓库协作规范

## Git 提交署名

- 用户是主提交人。所有后续提交的 Author 使用 `eiinu <eiinu@qq.com>`。
- 本仓库的 Git 身份配置为 `user.name=eiinu`、`user.email=eiinu@qq.com`，Committer 使用同一身份。只设置仓库级配置，不修改全局配置。
- Codex 仅作为协助作者，不替代用户成为主作者。Codex 协助的提交消息末尾须包含一次以下 trailer，并与正文空一行：

  ```text
  Co-authored-by: Codex <noreply@openai.com>
  ```

  该协助作者身份已核实于 [OpenAI 官方 Codex 源码中的默认 attribution](https://github.com/openai/codex/blob/e4a3612/codex-rs/core/src/commit_attribution.rs#L1)，不使用虚构邮箱。
- 提交前核对有效身份，提交后检查实际 Author、Committer 与 trailer。
- 后续禁止覆盖或改写已推送历史，禁止 force push（包括 `--force-with-lease`）。需要修正内容时使用正常追加提交。
- 2026-10-30 的五条实现提交署名修正是用户明确批准的单次例外：仅此次允许用绑定已核验远程 SHA 的 `--force-with-lease` 更新历史，保留初始提交、原代码树和逻辑拆分。此次例外不构成未来授权。
- 上述禁止仅针对已推送历史，不额外禁止正常整理尚未推送的本地提交。
- 本规则不额外规定提交消息的语言、标题格式或拆分粒度。

仓库级配置命令：

```sh
git config --local user.name eiinu
git config --local user.email eiinu@qq.com
```

## README 维护

- 新增重要功能或能力，或显著改变已有能力时，在同次改动中同步更新 README。
- 简单 bug 修复和小细节改动不要求更新 README。
- README 简洁介绍项目定位、当前功能与支持范围，描述已实现的事实，不作为更新日志。详细开发、运行、测试、架构与打包流程放在 `docs/`，README 仅保留必要链接。

## 生产目标与 Web 验证范围

- Electron 桌面端是生产目标；纯 Web 仅用于 UI 展示、截图及视觉效果验证，不作为生产版本。
- 实现新功能时无需为纯 Web 提供真实功能、兼容适配或生产级降级链路；功能实现与验收以桌面端为准。
- 可保留最小且明确标注的 UI mock/fixture，供布局与交互展示验证；不得将样例伪装为真实执行结果。
- Web UI 样例或截图不等于真实 Host/Electron 端到端功能证明。现有 Web/Host 开发验证工具可以保留，不因此要求新功能覆盖 Web。
