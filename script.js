(() => {
  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
  const nav = document.getElementById("nav");
  const menu = document.getElementById("menuToggle");
  if (menu && nav) menu.addEventListener("click", () => {
    const opened = nav.classList.toggle("open");
    menu.setAttribute("aria-expanded", String(opened));
    menu.setAttribute("aria-label", opened ? "关闭菜单" : "打开菜单");
  });
  if (nav) nav.querySelectorAll("a").forEach(link => link.addEventListener("click", () => nav.classList.remove("open")));
  const overlay = document.getElementById("adminOverlay");
  const open = document.getElementById("openAdmin");
  const closeButtons = [document.getElementById("closeAdmin"), document.getElementById("closeAdmin2")];
  const show = () => { if (overlay) { overlay.classList.add("open"); overlay.setAttribute("aria-hidden", "false"); } };
  const hide = () => { if (overlay) { overlay.classList.remove("open"); overlay.setAttribute("aria-hidden", "true"); } };
  if (open) open.addEventListener("click", show);
  closeButtons.forEach(button => button && button.addEventListener("click", hide));
  if (overlay) overlay.addEventListener("click", event => { if (event.target === overlay) hide(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") hide(); });
})();