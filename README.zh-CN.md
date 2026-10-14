# Strata Studio

![Strata Studio](docs/images/stratastudio-image.png)

[English](README.md) · [日本語](README.ja.md)

用于Strata推理引擎的Tauri 2桌面界面与Rust API网关。macOS构建面向Apple Silicon，推理使用现有Strata Metal后端。

## 启动

```sh
npm ci
npm run desktop
```

桌面应用自动启动`127.0.0.1:8080`上的API服务。不要同时运行独立服务器。

浏览器或无界面模式：

```sh
npm run build
cargo run -p studio-server --release
```

打开`http://127.0.0.1:8080`。

## 连接推理引擎

在引擎面板中填写Strata目录、已安装依赖的Python 3.10+解释器绝对路径，以及Strata安装生成的`strata-*.json`，然后点击“启动”。首次启动会检测Strata目录中的`.venv/bin/python`和现有配置。

选择“测试引擎”可在没有模型时验证API。模拟引擎的输出和日志速度不代表真实推理性能。

真实推理需要Metal可执行文件、模型文件和分词器。请参考[Strata Mac指南](Strata/docs/MAC.md)。Studio不会自动下载大型模型。在32GiB开发Mac上，保留Strata默认SSD专家流式加载和内存保护。

面板右上角图标可创建浮动窗口，再次点击即可停靠。关闭浮动窗口也会恢复原位置。Rust拥有配置、会话和生成中的文本，所有窗口读取共享状态。配置和会话在重启后保留。

## API与构建

复制API面板中的会话密钥，使用`Authorization: Bearer`或`x-api-key`。OpenAI端点为`/v1/chat/completions`，Anthropic端点为`/v1/messages`。密钥在重启后更新。

```sh
npm run desktop:build -- --bundles app --no-sign
```

Release构建面向Apple Silicon。发布签名与公证需要Apple开发者凭据。

更多内容见[English README](README.md)、[架构](docs/ARCHITECTURE.md)和[路线图](docs/ROADMAP.md)。
