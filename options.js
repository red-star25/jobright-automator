// options.js
const fileInput = document.getElementById("fileInput");
const list = document.getElementById("list");

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function render() {
  chrome.storage.local.get(["resumes", "defaultResumeId"], (data) => {
    const resumes = data.resumes || [];
    list.innerHTML = "";
    resumes.forEach((r) => {
      const row = document.createElement("div");
      row.className = "row";

      const nameSpan = document.createElement("span");
      nameSpan.className = "name";
      nameSpan.textContent = r.name;
      if (r.id === data.defaultResumeId) {
        const tag = document.createElement("span");
        tag.className = "default-tag";
        tag.textContent = "DEFAULT";
        nameSpan.appendChild(tag);
      }
      row.appendChild(nameSpan);

      const actions = document.createElement("div");
      actions.className = "actions";

      const setDefaultBtn = document.createElement("button");
      setDefaultBtn.textContent = "Set default";
      setDefaultBtn.onclick = () => {
        chrome.storage.local.set({ defaultResumeId: r.id }, render);
      };
      actions.appendChild(setDefaultBtn);

      const removeBtn = document.createElement("button");
      removeBtn.textContent = "Remove";
      removeBtn.onclick = () => {
        const next = resumes.filter((x) => x.id !== r.id);
        const updates = { resumes: next };
        if (data.defaultResumeId === r.id) updates.defaultResumeId = next[0] ? next[0].id : null;
        chrome.storage.local.set(updates, render);
      };
      actions.appendChild(removeBtn);

      row.appendChild(actions);
      list.appendChild(row);
    });
  });
}

fileInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  const newResumes = [];
  for (const file of files) {
    const dataUrl = await readFileAsDataUrl(file);
    newResumes.push({
      id: "resume_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      name: file.name,
      dataUrl,
    });
  }

  chrome.storage.local.get(["resumes", "defaultResumeId"], (data) => {
    const resumes = (data.resumes || []).concat(newResumes);
    const updates = { resumes };
    if (!data.defaultResumeId) updates.defaultResumeId = newResumes[0].id;
    chrome.storage.local.set(updates, () => {
      fileInput.value = "";
      render();
    });
  });
});

render();
