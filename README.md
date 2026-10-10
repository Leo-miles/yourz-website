# yourz.top 工厂资料库部署仓库

本仓库用于部署你提供的原版工厂资料库应用，不包含供应商数据，也不会自动导入 Excel。

## 首次部署前必须完成

1. 将提供给你的原始部署包命名为 `yourz-app-source.zip`，上传到本仓库根目录（与本 README、Dockerfile 同级）。不要解压后改名，不要把密码或真实工厂资料上传到 GitHub。
2. 确认 `yourz-app-source.zip` 已出现在仓库根目录。
3. 点击下面的 Render 部署入口，选择部署 Blueprint。
4. Render 首次创建服务时，按提示填写 `LOCAL_ADMIN_USER`（建议 3–32 个小写字母/数字/._-）及 `LOCAL_ADMIN_PASSWORD`（至少 14 个字符的随机强密码）。不要把密码发到聊天或写进 GitHub。
5. 服务建好后，先从 Render 控制台核对服务状态和持久化磁盘，再根据该服务显示的 DNS 要求到域名注册商设置 `yourz.top`。不要凭猜测填写 DNS。Render 自动签发和续期 HTTPS 证书。

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Leo-miles/yourz-website)

## 运行设计

- Node.js 24 + Docker。
- SQLite 文件写入独立的持久化磁盘 `/app/data/factory.sqlite`。
- 单实例部署，避免多个实例各自持有 SQLite 文件。
- 第一阶段使用应用内本地团队账号；企业微信/小程序接入以后再切换认证。
- 初始管理员可在“团队”页面添加员工账号、设置“可编辑”或“只读”角色。
- 数据库初始为空；备份需通过应用内备份功能定期导出并安全保存。

## 费用

此 Blueprint 使用 Render 付费 Web Service（当前公开起价约 US$7/月）及 1 GB 持久化磁盘（约 US$0.25/月），实际价格、税费及可用性以 Render 创建页面为准。部署前请核对费用；此仓库不会自动替你购买或付款。
