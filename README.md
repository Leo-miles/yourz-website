# yourz.top 工厂资料库

本仓库部署提供的原版工厂资料库应用。业务程序包 `yourz-app-source.zip` 已放在仓库根目录；不包含供应商数据，也不会自动导入 Excel。

## 部署

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Leo-miles/yourz-website)

1. 点击部署入口，登录/注册 Render，选择部署本仓库的 Blueprint。
2. 创建服务前核对资源与费用：Web Service 当前起价约 US$7/月，另有 1 GB 持久化磁盘约 US$0.25/月；实际金额、税费、可用性以 Render 确认页面为准。此仓库不会替你付款。
3. 按提示设置初始管理员账号 `LOCAL_ADMIN_USER` 与至少 14 字符的随机强密码 `LOCAL_ADMIN_PASSWORD`。不要把密码发到聊天或提交到 GitHub。
4. 等待首次部署完成，在 Render 服务控制台确认状态为 Live，并检查持久化磁盘已挂载。
5. 在 Render 的 Custom Domains 页面查看 `yourz.top` 所需 DNS 记录，再到你购买域名的平台配置。删除与该域名冲突的旧记录，尤其不要保留冲突的 AAAA 记录。回到 Render 点击 Verify，等待 HTTPS 证书签发后再访问 `https://yourz.top`。
6. 使用初始管理员账号进入网站，在“团队”页面为每位同事新建独立账号，并选择“可编辑”或“只读”角色。不要多人共用同一个账号。

## 运行方式

- Node.js 24 + Docker。
- SQLite 数据保存在独立持久化磁盘 `/app/data/factory.sqlite`。
- 单实例部署，避免多实例各自持有不同 SQLite 数据。
- 第一阶段使用应用内本地团队账号；后续再接入企业微信/小程序。
- 数据库初始为空。请在“备份”功能定期导出并将备份保存在公司可控的安全位置。
- 本地账号不是企业微信身份认证；完成正式接入后再切换企业身份与权限体系。
