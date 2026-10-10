# yourz.top 工厂资料库（免购买服务器版本）

本项目的最新运行版本使用 **Cloudflare Pages + Pages Functions + D1**，不用购买或维护传统 Linux 服务器。网页静态文件和后端接口托管在 Cloudflare，D1 保存同事共享的业务数据。

> 注意：Cloudflare Pages 版本已经在本地通过功能模拟测试，但尚未部署到 Cloudflare 生产环境。创建 Pages 项目、绑定 D1、设置管理员密码和配置域名仍需在对应控制台完成。免费额度有上限，不能把“本地测试通过”等同于“线上已验收”。

## 本次部署包

从 ChatGPT 对话中下载 `yourz-cloudflare-deploy.tar.gz`，然后在此仓库页面选择 **Add file → Upload files**，把压缩包上传到仓库根目录并提交。请上传原始压缩包，不要重新压缩或改名。

## Cloudflare Pages 设置

1. 登录 https://dash.cloudflare.com/，进入 **Workers & Pages → Create application → Pages → Connect to Git**。
2. 选择 GitHub 仓库 `Leo-miles/yourz-website`，生产分支为 `main`。
3. Framework preset 选 **None**，Build command 填：

   `tar -xzf yourz-cloudflare-deploy.tar.gz -C .`

4. Build output directory 填：

   `public`

5. 创建 Pages 项目并等待首次构建。构建成功后访问 Cloudflare 分配的 `*.pages.dev` 地址，先不改域名 DNS。

## 创建共享数据库

1. 在 Cloudflare 控制台打开 **Storage & databases → D1 SQL Database**，创建数据库，名称可用 `yourz-factory-db`。
2. 进入 Pages 项目 **Settings → Functions → D1 database bindings**，添加绑定：变量名 `DB`，数据库选择刚刚创建的数据库。
3. 在 Pages 项目 Settings → Variables and Secrets 的 Production 环境中添加：
   - `BOOTSTRAP_ADMIN_USER`：管理员用户名，例如 `admin`。
   - `BOOTSTRAP_ADMIN_PASSWORD`：设置为 Secret，使用至少 16 位随机强密码。
4. 保存后重新部署。首次进入 `/healthz` 应返回成功，随后打开网站登录管理员账号。请勿把管理员密码、会话 Cookie 或任何密钥发到聊天或写入代码仓库。
5. 管理员进入 Team / 团队，为同事分别创建账号并分配 Viewer（只读）或 Editor（可编辑）权限。不同账号使用的是同一个 D1 数据库。

## 绑定 yourz.top

确认 `*.pages.dev` 网站及共享功能测试通过后，再在 Pages 项目 **Custom domains → Set up a domain** 添加 `yourz.top`。

根域名需要先将 `yourz.top` 加为 Cloudflare zone 并把域名注册商处的 nameservers 改为 Cloudflare 指定的 nameservers。修改之前，若有企业邮箱或其他 DNS 记录，须先核对并搬入相应的 MX、TXT、CNAME 等记录，避免影响邮件或其他服务。不要照抄网上示例 IP；只使用 Cloudflare 控制台为你当前站点生成的指引。Cloudflare 验证通过后会自动配置 HTTPS。

## 功能与数据

- 当前阶段用临时本地账号登录，企业微信及小程序暂不接入。
- 业务数据初始为空，不自动导入 `Supplier_Factory_Database.xlsx`。
- 本地测试覆盖：首次管理员初始化、独立账号登录、不同账号读取共享状态、新建员工、只读/可编辑角色、冲突保护、备份及退出。
- D1 免费计划有每日读写和存储额度限制；超过额度时当天的数据库查询可能失败。请定期使用系统备份，并安全保管离线备份。
- Cloudflare 全球节点不等于中国大陆专属网络。正式让义乌、深圳同事长期使用前，要实测当地网络速度及稳定性。
- 企业微信及小程序将在下一阶段单独接入，不会在本次部署中配置它们。
