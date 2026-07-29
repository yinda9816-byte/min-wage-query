/**
 * 最低工资数据抓取脚本
 * 从 https://m12333.cn/policy/wrib.html 抓取全国各省市最低工资标准
 * 由 GitHub Actions 每日 09:00（UTC+8，即 UTC 01:00）自动执行
 *
 * 用法: node scripts/fetch-wages.cjs
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const SOURCE_URL = "https://m12333.cn/policy/wrib.html";
const OUTPUT_PATH = path.join(__dirname, "..", "src", "data", "wages.js");
const LOG_PATH = path.join(__dirname, "..", "src", "data", "update-log.js");
const MAX_LOGS = 5;

// 省份 -> 地区 映射
const REGION_MAP = {
  "北京": "华北", "天津": "华北", "河北": "华北", "山西": "华北", "内蒙古": "华北",
  "辽宁": "东北", "吉林": "东北", "黑龙江": "东北",
  "上海": "华东", "江苏": "华东", "浙江": "华东", "安徽": "华东",
  "福建": "华东", "江西": "华东", "山东": "华东",
  "河南": "华中", "湖北": "华中", "湖南": "华中",
  "广东": "华南", "广西": "华南", "海南": "华南",
  "重庆": "西南", "四川": "西南", "贵州": "西南",
  "云南": "西南", "西藏": "西南",
  "陕西": "西北", "甘肃": "西北", "青海": "西北", "宁夏": "西北", "新疆": "西北",
};

// 省份 -> 政府网站 映射
const GOV_URL_MAP = {
  "北京": "https://rsj.beijing.gov.cn/",
  "天津": "https://hrss.tj.gov.cn/",
  "河北": "https://rst.hebei.gov.cn/",
  "山西": "https://rst.shanxi.gov.cn/",
  "内蒙古": "https://rst.nmg.gov.cn/",
  "辽宁": "https://rst.ln.gov.cn/",
  "吉林": "http://hrss.jl.gov.cn/",
  "黑龙江": "https://hrss.hlj.gov.cn/",
  "上海": "https://rsj.sh.gov.cn/",
  "江苏": "https://jshrss.jiangsu.gov.cn/",
  "浙江": "https://rlsbt.zj.gov.cn/",
  "安徽": "https://hrss.ah.gov.cn/",
  "福建": "https://rst.fujian.gov.cn/",
  "江西": "http://rst.jiangxi.gov.cn/",
  "山东": "http://hrss.shandong.gov.cn/",
  "河南": "https://hrss.henan.gov.cn/",
  "湖北": "https://rst.hubei.gov.cn/",
  "湖南": "https://rst.hunan.gov.cn/",
  "广东": "https://hrss.gd.gov.cn/",
  "广西": "https://rst.gxzf.gov.cn/",
  "海南": "https://hrss.hainan.gov.cn/",
  "重庆": "https://rlsbj.cq.gov.cn/",
  "四川": "https://rst.sc.gov.cn/",
  "贵州": "https://rst.guizhou.gov.cn/",
  "云南": "https://hrss.yn.gov.cn/",
  "西藏": "http://hrss.xizang.gov.cn/",
  "陕西": "http://rst.shaanxi.gov.cn/",
  "甘肃": "https://rst.gansu.gov.cn/",
  "青海": "https://rst.qinghai.gov.cn/",
  "宁夏": "https://hrss.nx.gov.cn/",
  "新疆": "https://rst.xinjiang.gov.cn/",
};

function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchHTML(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error("HTTP " + res.statusCode));
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function parseWageTable(html) {
  const results = [];
  const rowRegex = /\|\s*([^|]+?)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|/g;

  let match;
  let id = 1;
  while ((match = rowRegex.exec(html)) !== null) {
    const province = match[1].trim();
    const effectiveDate = match[2].trim();
    const tier1Raw = match[3].trim();
    const tier2Raw = match[4].trim();
    const tier3Raw = match[5].trim();
    const tier4Raw = match[6].trim();

    if (province === "省市区" || province.includes("执行时间")) continue;

    const parseWage = (raw) => {
      const numMatch = raw.match(/(\d{3,5})/);
      return numMatch ? parseInt(numMatch[1], 10) : null;
    };

    const tier1 = parseWage(tier1Raw);
    const tier2 = parseWage(tier2Raw);
    const tier3 = parseWage(tier3Raw);
    const tier4 = parseWage(tier4Raw);

    if (!tier1) continue;

    results.push({
      id,
      province,
      effectiveDate,
      tier1,
      tier2,
      tier3,
      tier4,
      region: REGION_MAP[province] || "其他",
      govUrl: GOV_URL_MAP[province] || "",
    });
    id++;
  }

  return results;
}

function parsePublishDate(html) {
  const match = html.match(/发布[：:]\s*(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  return new Date().toISOString().slice(0, 10);
}

function generateWagesFile(data, publishDate) {
  const regions = ["华北", "东北", "华东", "华中", "华南", "西南", "西北"];

  const dataLines = data.map((item) => {
    const tier1 = item.tier1;
    const tier2 = item.tier2 === null ? "null" : item.tier2;
    const tier3 = item.tier3 === null ? "null" : item.tier3;
    const tier4 = item.tier4 === null ? "null" : item.tier4;
    const provincePad = item.province.padEnd(4, "\u3000");
    return '  { id: ' + String(item.id).padStart(2, " ") + ',  province: "' + provincePad + '", effectiveDate: "' + item.effectiveDate + '", tier1: ' + tier1 + ', tier2: ' + tier2 + ', tier3: ' + tier3 + ', tier4: ' + tier4 + ', region: "' + item.region + '", govUrl: "' + item.govUrl + '" },';
  }).join("\n");

  return '// 全国各省市最低工资标准数据\n' +
    '// 数据来源：https://m12333.cn/policy/wrib.html\n' +
    '// 更新频率：每天上午9点\n' +
    '// 此文件由 GitHub Actions 自动生成，请勿手动编辑\n' +
    '// 最后更新：' + new Date().toISOString() + '\n\n' +
    'export const wageData = [\n' + dataLines + '\n];\n\n' +
    'export const regions = ' + JSON.stringify(regions) + ';\n\n' +
    'export const dataUpdateInfo = {\n' +
    '  publishDate: "' + publishDate + '",\n' +
    '  updateFrequency: "每日上午 09:00",\n' +
    '  sourceName: "人社通（m12333.cn）",\n' +
    '  sourceUrl: "https://m12333.cn/policy/wrib.html",\n' +
    '};\n\n' +
    'export const notes = [\n' +
    '  "本表未包含我国港、澳、台地区数据。",\n' +
    '  "用人单位执行最低工资标准时，应剔除：加班工资；中班、夜班、高温、低温、井下、有毒有害等特殊津贴；国家规定的劳动者福利待遇等。",\n' +
    '  "本站非政府官网，所收藏的信息仅供参考，请以各地政府官方公布为准。",\n' +
    '];\n';
}

function writeUpdateLog(status, action, message) {
  const now = new Date().toISOString();
  const newLog = { timestamp: now, status, action, message };

  let logs = [];
  if (fs.existsSync(LOG_PATH)) {
    const content = fs.readFileSync(LOG_PATH, "utf8");
    const match = content.match(/export const updateLogs = \[([\s\S]*)\];/);
    if (match) {
      try {
        logs = JSON.parse("[" + match[1].trim().replace(/,\s*$/, "") + "]");
      } catch (e) {
        logs = [];
      }
    }
  }

  logs.unshift(newLog);
  logs = logs.slice(0, MAX_LOGS);

  const logLines = logs.map((log) =>
    '  { timestamp: "' + log.timestamp + '", status: "' + log.status + '", action: "' + log.action + '", message: "' + log.message + '" },'
  ).join("\n");

  const fileContent = '// 数据更新日志（由 GitHub Actions 自动写入，仅保留最近 ' + MAX_LOGS + ' 条）\n' +
    '// status: "success" | "failed"\n' +
    '// action: "updated" | "no-change" | "error"\n\n' +
    'export const updateLogs = [\n' + logLines + '\n];\n';

  fs.writeFileSync(LOG_PATH, fileContent, "utf8");
  console.log("📝 已写入更新日志：" + status + " / " + action);
}

async function main() {
  try {
    console.log("📦 正在抓取数据源…");
    const html = await fetchHTML(SOURCE_URL);
    console.log("✅ 成功获取页面内容（" + html.length + " 字节）");

    console.log("📊 正在解析工资数据…");
    const wageData = parseWageTable(html);

    if (wageData.length === 0) {
      console.error("❌ 未能解析到任何工资数据，请检查页面结构是否变更");
      writeUpdateLog("failed", "error", "未能解析到任何工资数据，页面结构可能已变更");
      process.exit(1);
    }

    console.log("✅ 成功解析 " + wageData.length + " 条记录");

    const publishDate = parsePublishDate(html);
    console.log("📅 发布日期：" + publishDate);

    const fileContent = generateWagesFile(wageData, publishDate);

    const existingContent = fs.existsSync(OUTPUT_PATH)
      ? fs.readFileSync(OUTPUT_PATH, "utf8")
      : "";

    if (existingContent.includes('publishDate: "' + publishDate + '"') && existingContent.length > 0) {
      const existingDataMatch = existingContent.match(/export const wageData = \[([\s\S]*?)\];/);
      const newDataMatch = fileContent.match(/export const wageData = \[([\s\S]*?)\];/);
      if (existingDataMatch && newDataMatch && existingDataMatch[1].trim() === newDataMatch[1].trim()) {
        console.log("ℹ️  数据未发生变化，跳过更新");
        writeUpdateLog("success", "no-change", "数据未发生变化，发布日期 " + publishDate + "，共 " + wageData.length + " 条记录");
        return;
      }
    }

    // 确保 src/data 目录存在
    const dataDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_PATH, fileContent, "utf8");
    console.log("✅ 已写入文件：" + OUTPUT_PATH);
    console.log("🎉 数据更新完成！");
    writeUpdateLog("success", "updated", "数据更新成功，共解析 " + wageData.length + " 条记录，发布日期 " + publishDate);
  } catch (error) {
    console.error("❌ 抓取失败：", error.message);
    writeUpdateLog("failed", "error", "抓取失败：" + error.message);
    process.exit(1);
  }
}

main();
