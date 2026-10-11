# yourz.top 工厂资料库

本项目采用 Cloudflare Pages、Pages Functions 和 D1 数据库，目标是不购买传统服务器，由 GitHub 自动发布网站。

目前程序已在本地通过功能模拟测试，**尚未部署到线上**。请不要把本地测试通过视为线上验收通过。

## 部署步骤

### 1. 在 GitHub 保存部署密钥

打开本仓库的「设置 → 密钥与变量 → 操作」，添加以下四条仓库密钥：

| 名称 | 内容 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare 中创建的部署专用 API 令牌 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户编号 |
| `BOOTSTRAP_ADMIN_USER` | 初始管理员用户名，3–32 位英文小写字母、数字、点、下划线或连字符，例如 `admin` |
| `BOOTSTRAP_ADMIN_PASSWORD` | 初始管理员密码，至少 16 位，建议使用随机强密码 |

不要把令牌或管理员密码写入代码，也不要发到聊天、工单或公开仓库中。前三、四项以外不需要额外创建密钥。

### 2. 上传网站程序包

下载程序包 `yourz-runtime.tar.xz`，在仓库首页选择「添加文件 → 上传文件」，把这个压缩包上传到**仓库根目录**，保持原文件名不变，然后提交到 `main` 分支。

上传地址：https://github.com/Leo-miles/yourz-website/upload/main

### 3. 查看自动部署结果

上传后，GitHub Actions 会自动进行完整性校验、程序检查、功能模拟测试，并创建或查找 Cloudflare D1 数据库与 Pages 项目，写入数据库绑定和初始管理员，然后发布网站。

查看部署记录：https://github.com/Leo-miles/yourz-website/actions

只有当最新一次任务明确显示成功，且 Cloudflare Pages 后台出现成功的部署记录，才算完成发布。成功后默认预览地址为：

https://yourz-website.pages.dev

如果任务失败，打开对应任务，查看第一个失败步骤的日志。日志不会需要你提供 API 令牌或管理员密码。

## 初次登录与验证

首次打开网站后，使用第 1 步自行设置的管理员用户名和密码登录。程序首次访问时会初始化数据库结构与空白资料库。请先用测试记录验证新增、编辑、权限、退出和备份等功能，再邀请同事使用。

- 同事共用同一个 D1 数据库，但应使用各自的账号。
- 管理员可创建同事账号并分配只读或可编辑权限。
- 当前阶段使用临时本地账号登录，企业微信与小程序尚未接入。
- 业务资料初始为空，不会自动导入旧版 Excel。
- D1 免费额度有限，请定期导出并安全保存备份。

## 绑定 yourz.top

先确认 `pages.dev` 地址、登录和多人共享资料测试成功，再在 Cloudflare Pages 项目中添加自定义域名 `yourz.top`。

根域名需要先加入 Cloudflare 的域名区域，再按 Cloudflare 给出的指引将注册商处的域名服务器改为指定地址。**改之前先核对并迁移已有的企业邮箱及其他 DNS 记录**，避免影响邮件或现有服务。不要照抄网上示例 IP；只按自己控制台显示的指引操作。Cloudflare 完成域名验证后会配置 HTTPS。

## 运行说明

- 部署工作流文件：`.github/workflows/deploy-cloudflare.yml`
- 共享数据库名称：`yourz-factory-db`
- 数据库绑定名称：`DB`
- 页面项目名称：`yourz-website`
- 计划将数据库主位置提示设置为亚太地区。Cloudflare 全球节点不代表中国大陆专属网络，正式让义乌和深圳同事长期使用前应实测当地速度与稳定性。
