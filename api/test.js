export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const key = process.env.ANTHROPIC_API_KEY;

  if (!key) {
    return res.status(200).json({
      status: "MISSING",
      message: "ANTHROPIC_API_KEY is not set at all",
    });
  }

  return res.status(200).json({
    status: "FOUND",
    length: key.length,
    prefix: key.substring(0, 14),
    hasSpaces: key !== key.trim(),
    startsCorrectly: key.startsWith("sk-ant-"),
  });
}
