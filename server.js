// 简单 Node.js 后端：接收投递表单并给候选人发「录用」邮件

const express = require("express");
const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");
const dns = require("dns");

const app = express();
const PORT = process.env.PORT || 3000;

// 解析表单 application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));
// 解析 JSON（如果后面想用 fetch 也可以）
app.use(express.json());
// 静态文件：把当前目录下的页面通过 http://localhost:3000 访问
app.use(express.static(__dirname));

// 友好路由：不带 .html 后缀的访问
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "aba-aba-company.html"));
});

app.get("/about", (req, res) => {
  res.sendFile(path.join(__dirname, "about.html"));
});

app.get("/products", (req, res) => {
  res.sendFile(path.join(__dirname, "products.html"));
});

app.get("/careers", (req, res) => {
  res.sendFile(path.join(__dirname, "careers.html"));
});

app.get("/contact", (req, res) => {
  res.sendFile(path.join(__dirname, "contact.html"));
});

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
// 端口写死：587（STARTTLS）
const SMTP_PORT = 587;
const SMTP_SECURE =
  typeof process.env.SMTP_SECURE === "string"
    ? ["1", "true", "yes", "on"].includes(process.env.SMTP_SECURE.toLowerCase())
    : false;
// From 写死：部分 SMTP（如 MailerSend）要求该地址已验证
const SMTP_FROM = "abab.limited@jzh666.store";

if (!SMTP_USER || !SMTP_PASS) {
  console.warn(
    "SMTP 未配置：请设置环境变量 SMTP_USER / SMTP_PASS，否则无法发送邮件。"
  );
}

// 通用 SMTP（默认仍是 Gmail SMTP；也支持 MailerSend 等）
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE, // 465 通常为 true；587/2525 通常为 false（STARTTLS）
  requireTLS: !SMTP_SECURE && SMTP_PORT === 587,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS
  }
});

// -----------------------------
// 反刷保护 + Offer 余量（轻量版）
// -----------------------------
const OFFER_STATE_FILE = path.join(__dirname, "offer-state.json");
const OFFER_TOTAL_DEFAULT = Number.parseInt(process.env.OFFER_TOTAL || "", 10);
const OFFER_TOTAL = Number.isFinite(OFFER_TOTAL_DEFAULT) && OFFER_TOTAL_DEFAULT > 0 ? OFFER_TOTAL_DEFAULT : 200;

function todayKeyUTC() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function readOfferState() {
  try {
    const raw = fs.readFileSync(OFFER_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const remaining = Number(parsed?.offersRemaining);
    if (Number.isFinite(remaining) && remaining >= 0) {
      return { offersRemaining: remaining, updatedAt: parsed?.updatedAt || null };
    }
  } catch (_) {}
  return { offersRemaining: OFFER_TOTAL, updatedAt: null };
}

function writeOfferState(nextState) {
  const safe = {
    offersRemaining: Math.max(0, Number(nextState?.offersRemaining) || 0),
    updatedAt: new Date().toISOString()
  };
  const tmp = `${OFFER_STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(safe, null, 2), "utf8");
  fs.renameSync(tmp, OFFER_STATE_FILE);
  return safe;
}

let offerState = readOfferState();

// 简单限流（内存版）：适合小站点/单进程。多实例部署需换 Redis 等。
const rateBuckets = new Map(); // key -> { count, resetAt }
function takeToken(key, limit, windowMs) {
  const now = Date.now();
  const cur = rateBuckets.get(key);
  if (!cur || cur.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  if (cur.count >= limit) return { ok: false, remaining: 0, resetAt: cur.resetAt };
  cur.count += 1;
  return { ok: true, remaining: limit - cur.count, resetAt: cur.resetAt };
}

function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  const xr = req.headers["x-real-ip"];
  if (typeof xr === "string" && xr.trim()) return xr.trim();
  return req.ip || req.connection?.remoteAddress || "unknown";
}

function normalizeEmail(input) {
  return String(input || "").trim().toLowerCase();
}

function isEmailSyntaxValid(email) {
  // 够用的语法检查：避免明显错误地址触发 SMTP 尝试
  if (!email || email.length > 254) return false;
  const re = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
  return re.test(email);
}

async function hasMxRecord(domain, timeoutMs = 1200) {
  const p = dns.promises.resolveMx(domain);
  const t = new Promise((_, reject) => setTimeout(() => reject(new Error("DNS_TIMEOUT")), timeoutMs));
  try {
    const records = await Promise.race([p, t]);
    return Array.isArray(records) && records.length > 0;
  } catch (_) {
    return false;
  }
}

app.get("/api/offer-status", (req, res) => {
  // 仅返回剩余数量，不暴露限流/配额细节
  res.json({ ok: true, offersRemaining: offerState.offersRemaining });
});

// Render/线上 SMTP 自检接口（建议配置 SMTP_TEST_TOKEN 防止被滥用）
// 用法：POST /api/smtp-test  body: { to: "xxx@xxx.com", token?: "..." }
app.post("/api/smtp-test", async (req, res) => {
  const token = req.body?.token || req.query?.token;
  const required = process.env.SMTP_TEST_TOKEN;
  if (required && token !== required) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const to = (req.body?.to || "").trim();
  if (!to) return res.status(400).json({ ok: false, error: "Missing `to`" });
  if (!SMTP_USER || !SMTP_PASS) {
    return res.status(500).json({ ok: false, error: "Missing SMTP_USER/SMTP_PASS" });
  }

  try {
    await transporter.sendMail({
      from: `"阿巴阿巴互联网集团 SMTP Test" <${SMTP_USER}>`,
      to,
      subject: "SMTP Test - 阿巴阿巴（Gmail）",
      text: "如果你收到了这封邮件，说明 Render -> Gmail SMTP 通了。",
      html:
        '<div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:16px;background:#f5f5f7;">' +
        '<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;">' +
        '<div style="font-size:14px;font-weight:700;color:#111827;">SMTP 测试成功</div>' +
        '<div style="margin-top:6px;color:#6b7280;font-size:12px;line-height:1.6;">' +
        "如果你收到了这封邮件，说明 Render 到 Gmail 的 SMTP 链路没有被拦截。" +
        "</div></div></div>"
    });
    res.json({ ok: true });
  } catch (e) {
    console.error("SMTP TEST failed:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e), code: e?.code });
  }
});

app.post("/api/apply", async (req, res) => {
  const { name, email, position, customPosition, story } = req.body;

  // Offer 已发完：直接关闭投递
  if ((offerState?.offersRemaining ?? 0) <= 0) {
    return res.redirect("/aba-aba-company.html?applySoldOut=1");
  }

  const clientIp = getClientIp(req);
  const cleanEmail = normalizeEmail(email);

  // 轻量防刷：同 IP 短时间 + 同 IP 每日 + 同邮箱每日
  const day = todayKeyUTC();
  const burst = takeToken(`ip:${clientIp}:m1`, 5, 60 * 1000); // 1 分钟 5 次
  if (!burst.ok) return res.redirect("/aba-aba-company.html?applyRateLimited=1");
  const ipDaily = takeToken(`ip:${clientIp}:d:${day}`, 25, 24 * 60 * 60 * 1000);
  if (!ipDaily.ok) return res.redirect("/aba-aba-company.html?applyRateLimited=1");
  const emailDaily = takeToken(`em:${cleanEmail}:d:${day}`, 3, 24 * 60 * 60 * 1000);
  if (!emailDaily.ok) return res.redirect("/aba-aba-company.html?applyRateLimited=1");

  if (!cleanEmail) return res.redirect("/aba-aba-company.html?applyInvalidEmail=1");
  if (!isEmailSyntaxValid(cleanEmail)) return res.redirect("/aba-aba-company.html?applyInvalidEmail=1");

  // DNS MX 校验：避免明显不存在的域名触发 SMTP 尝试
  const domain = cleanEmail.split("@")[1];
  const mxOk = await hasMxRecord(domain);
  if (!mxOk) return res.redirect("/aba-aba-company.html?applyInvalidEmail=1");

  if (!SMTP_USER || !SMTP_PASS) {
    return res.redirect("/aba-aba-company.html?applyError=1");
  }

  const displayName = (name || "这位神秘阿巴友").trim();
  const customPos = String(customPosition || "").trim();
  const displayPosition =
    position === "__custom__"
      ? (customPos || "你自创的传奇岗位")
      : (String(position || "").trim() || "你自创的传奇岗位");

  const salaryK = Math.floor(Math.random() * (10000 - 100 + 1)) + 100; // 100k ~ 10000k 整数
  const baseSalary = `${salaryK}k/月 × 20 薪`;

  const plainText = [
    `${displayName} 你好：`,
    "",
    `恭喜你，在阿巴阿巴互联网集团的「${displayPosition}」岗位中，`,
    "凭借你精彩的阿巴能力，已经在我们的想象宇宙中成功拿到 Offer！（纯属搞笑）",
    "",
    `本次 Offer 参考薪资为：${baseSalary}（想象用，不具备法律效力）。`,
    "",
    "这是一封纯搞笑的录用通知，不具备任何法律和就业效力。",
    "如果你真的收到了这封邮件，说明我们的后端和 SMTP 配置是好的。",
    "",
    "—— 阿巴阿巴互联网集团 · 虚构 HR 中心"
  ].join("\n");

  const htmlContent = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f7;padding:24px;">
    <table width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;box-shadow:0 18px 40px rgba(15,23,42,0.12);overflow:hidden;">
      <tr>
        <td style="padding:18px 22px;border-bottom:1px solid #f3f4f6;background:linear-gradient(135deg,#ff6a00,#ff9f1a);color:#fff;">
          <div style="font-size:14px;opacity:.9;">阿巴阿巴互联网集团 · Offer 通知（搞笑版）</div>
          <div style="font-size:20px;font-weight:700;margin-top:4px;">${displayPosition} 录用结果</div>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 22px 8px 22px;font-size:14px;color:#111827;line-height:1.7;">
          <p style="margin:0 0 12px 0;">${displayName} 你好：</p>
          <p style="margin:0 0 12px 0;">
            经过严谨而抽象的阿巴评审流程，我们非常高兴地通知你：<br />
            你已在 <strong>阿巴阿巴互联网集团</strong> 的想象宇宙中，
            被录用为「<strong>${displayPosition}</strong>」岗位。
          </p>
          <p style="margin:0 0 12px 0;">
            为了不辜负你超越 KPI 的阿巴潜力，我们为你准备了一份「看起来很离谱」的薪资方案：
          </p>
          <table cellspacing="0" cellpadding="0" style="width:100%;margin:10px 0 14px 0;border-collapse:collapse;font-size:13px;">
            <tr>
              <td style="padding:6px 0;color:#6b7280;width:90px;">岗位名称</td>
              <td style="padding:6px 0;color:#111827;">${displayPosition}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#6b7280;">薪资结构</td>
              <td style="padding:6px 0;color:#111827;"><strong>${baseSalary}</strong></td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#6b7280;">发放说明</td>
              <td style="padding:6px 0;color:#111827;">以 PPT 为准，以段子为主，一切解释权归阿巴宇宙所有。</td>
            </tr>
          </table>
          ${
            story
              ? `<p style="margin:0 0 12px 0;">
                  我们已经认真阅读了你分享的这段「最能阿巴」的经历：<br />
                  <span style="display:inline-block;margin-top:4px;padding:8px 10px;border-radius:10px;background:#f9fafb;border:1px dashed #e5e7eb;color:#4b5563;">
                    ${String(story).replace(/</g, "&lt;").replace(/>/g, "&gt;")}
                  </span>
                </p>`
              : ""
          }
          <p style="margin:0 0 12px 0;color:#6b7280;font-size:12px;">
            温馨提示：本 Offer 仅为搞笑创作，不构成任何真实招聘、录用或法律承诺。<br />
            如果你此刻会心一笑，那这份 Offer 就已经「到账」了。
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 22px 18px 22px;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af;background:#f9fafb;">
          <div>—— 阿巴阿巴互联网集团 · 虚构 HR 中心</div>
          <div style="margin-top:4px;">
            若你愿意，可以把这封邮件截图发给正在加班的朋友，一起加入阿巴宇宙。
          </div>
        </td>
      </tr>
    </table>
  </div>
  `;

  const mailOptions = {
    // 发件人必须与 SMTP 登录账号一致，否则服务端会 553 拒绝
    from: `"阿巴阿巴互联网集团 HR" <${SMTP_FROM}>`,
    to: cleanEmail,
    subject: `【阿巴阿巴】恭喜你被录用为：${displayPosition}`,
    text: plainText,
    html: htmlContent
  };

  try {
    await transporter.sendMail(mailOptions);
    // 发送成功：扣减 offer 并持久化
    offerState = writeOfferState({ offersRemaining: (offerState.offersRemaining || 0) - 1 });
    // 成功后跳转回首页，并带上成功标记
    res.redirect(`/aba-aba-company.html?applySuccess=1&offersLeft=${encodeURIComponent(String(offerState.offersRemaining))}`);
  } catch (err) {
    console.error("发送邮件失败:", err);
    // 失败也跳回首页，只是带上错误标记
    res.redirect("/aba-aba-company.html?applyError=1");
  }
});

app.listen(PORT, () => {
  console.log(`阿巴阿巴后端已在 http://localhost:${PORT} 启动`);
});

