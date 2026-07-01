// dashboard.js
const tableWrap = document.getElementById("tableWrap");
const clearBtn = document.getElementById("clearBtn");

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function render() {
  chrome.storage.local.get("outreachLog", (data) => {
    const log = (data.outreachLog || []).slice().sort((a, b) => b.date - a.date);

    const todayStr = new Date().toDateString();
    const today = log.filter((e) => new Date(e.date).toDateString() === todayStr).length;
    const replied = log.filter((e) => e.status === "replied").length;
    const rate = log.length ? Math.round((replied / log.length) * 100) : 0;

    document.getElementById("statToday").textContent = today;
    document.getElementById("statTotal").textContent = log.length;
    document.getElementById("statReplied").textContent = replied;
    document.getElementById("statRate").textContent = rate + "%";

    if (!log.length) {
      tableWrap.innerHTML = '<div class="empty">No outreach logged yet. Run the autopilot on a job page to start building this list.</div>';
      return;
    }

    const rows = log.map((e) => `
      <tr>
        <td>${escapeHtml(e.name || "Unknown")}</td>
        <td>${escapeHtml(e.company || "")}</td>
        <td><span class="channel-pill channel-${e.channel}">${e.channel === "email" ? "Email" : "LinkedIn"}</span></td>
        <td>${escapeHtml(e.channel === "email" ? (e.identifier || "") : (e.linkedinUrl || e.identifier || ""))}</td>
        <td>${formatDate(e.date)}</td>
        <td><span class="status-pill ${e.status === "replied" ? "status-replied" : ""}">${e.status === "replied" ? "Replied" : "Sent"}</span></td>
        <td>${e.status === "replied"
          ? `<button class="reply-btn" data-id="${e.id}" data-action="unreply">Undo</button>`
          : `<button class="reply-btn" data-id="${e.id}" data-action="reply">Mark replied</button>`}</td>
      </tr>
    `).join("");

    tableWrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Company</th><th>Channel</th><th>Identifier</th><th>Date</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    tableWrap.querySelectorAll("button[data-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const newStatus = btn.getAttribute("data-action") === "reply" ? "replied" : "sent";
        setStatus(id, newStatus);
      });
    });
  });
}

function setStatus(id, status) {
  chrome.storage.local.get("outreachLog", (data) => {
    const log = data.outreachLog || [];
    const entry = log.find((e) => e.id === id);
    if (entry) entry.status = status;
    chrome.storage.local.set({ outreachLog: log }, render);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

clearBtn.addEventListener("click", () => {
  if (!confirm("Clear the entire outreach log? This can't be undone.")) return;
  chrome.storage.local.set({ outreachLog: [] }, render);
});

render();
