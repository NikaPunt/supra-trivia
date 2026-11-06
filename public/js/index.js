import { $, api } from "./common.js";
$("#code").value = new URLSearchParams(location.search).get("code") ?? "";
$("#join").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/join", { method: "POST", body: { code: $("#code").value, nickname: $("#nick").value } });
    location.href = "/play.html";
  } catch (err) { $("#err").textContent = err.message; }
});
