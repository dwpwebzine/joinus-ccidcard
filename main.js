// ===== 기본 유틸 =====
const isiOS = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const hasEmoji = (s) => /\p{Extended_Pictographic}/u.test(s);

// 요소들
const cardImg = document.getElementById("cardImg");
const photoPrev = document.getElementById("photoPreview");
const holeArea = document.getElementById("holeArea");
const fileInput = document.getElementById("fileInput");
const saveBtn = document.getElementById("saveBtn");
const tweetBtn = document.getElementById("tweetBtn");
const canvas = document.getElementById("exportCanvas");

// ===== 이미지맵 좌표 갱신 =====
function updateImageMap() {
  const rect = cardImg.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const s = getComputedStyle(document.documentElement);
  const cardW = parseFloat(s.getPropertyValue("--card-w"));
  const cardH = parseFloat(s.getPropertyValue("--card-h"));
  const holeX = parseFloat(s.getPropertyValue("--hole-x"));
  const holeY = parseFloat(s.getPropertyValue("--hole-y"));
  const holeW = parseFloat(s.getPropertyValue("--hole-w"));
  const holeH = parseFloat(s.getPropertyValue("--hole-h"));

  const x1 = Math.round(rect.width * (holeX / cardW));
  const y1 = Math.round(rect.height * (holeY / cardH));
  const x2 = Math.round(rect.width * ((holeX + holeW) / cardW));
  const y2 = Math.round(rect.height * ((holeY + holeH) / cardH));

  holeArea.coords = `${x1},${y1},${x2},${y2}`;
}
cardImg.addEventListener("load", updateImageMap);
window.addEventListener("resize", updateImageMap);
window.addEventListener("orientationchange", updateImageMap);
if (cardImg.complete) updateImageMap();

// ===== 업로드 트리거 =====
holeArea.addEventListener("click", (e) => {
  e.preventDefault();
  fileInput.click();
});
fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0] || null;
  if (!f) return;
  const url = URL.createObjectURL(f);
  photoPrev.src = url;
  photoPrev.onload = () => {
    photoPrev.style.display = "block";
  };
});

// ===== 텍스트 박스 엔터금지 + 개행 제거 =====
document.querySelectorAll(".textLine").forEach((el) => {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.preventDefault();
  });
  el.addEventListener("input", () => {
    const s = el.innerText.replace(/[\r\n\t]+/g, " ").trim();
    if (s !== el.innerText) {
      const sel = window.getSelection(),
        r = document.createRange();
      el.innerText = s;
      r.selectNodeContents(el);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  });
});

// ===== 폰트 준비 =====
async function ensureFonts() {
  try {
    const rs = getComputedStyle(document.documentElement);
    const ko = rs.getPropertyValue("--font-ko").trim().replace(/^["']|["']$/g, "");
    const en = rs.getPropertyValue("--font-en").trim().replace(/^["']|["']$/g, "");
    await Promise.all([
      document.fonts.load(`700 24px ${ko}`),
      document.fonts.load(`700 24px ${en}`),
    ]);
    await document.fonts.ready;
  } catch (e) {}
}

// ===== 한글/영문 섞여있을 때 베이스라인/스케일 보정 =====
function drawMixedRun(ctx, text, x, y, maxW, opt) {
  const runs =
    text.match(
      /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]+|[^\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]+/g
    ) || [];
  let cursor = x;
  for (const run of runs) {
    const isKO = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/.test(run[0]);
    const size = isKO ? opt.baseSize * opt.koScale : opt.baseSize * opt.enScale;
    const family = isKO ? opt.koFamily : opt.enFamily;
    const baseEm = isKO ? opt.koBaselineEm : opt.enBaselineEm;

    ctx.font = `${opt.weight} ${size}px ${family}`;
    const yAdj = y + baseEm * size;
    const w = ctx.measureText(run).width;
    if (cursor + w > x + maxW) break;
    ctx.fillText(run, cursor, yAdj);
    cursor += w;
  }
}

// ===== 한 줄 그리기 =====
function drawOneLine(ctx, el, tx, ty, tw, th) {
  const cs = getComputedStyle(el);
  const weight = cs.fontWeight || "700";
  const baseSize = parseFloat(cs.fontSize) || 20;
  const lineH = parseFloat(cs.lineHeight) || baseSize * 1.3;
  const leading = (lineH - baseSize) / 2;

  const rs = getComputedStyle(document.documentElement);
  const koFamily = rs.getPropertyValue("--font-ko").trim().replace(/^["']|["']$/g, "");
  const enFamily = rs.getPropertyValue("--font-en").trim().replace(/^["']|["']$/g, "");
  const koScale = parseFloat(rs.getPropertyValue("--ko-scale")) || 1;
  const enScale = parseFloat(rs.getPropertyValue("--en-scale")) || 1;
  const koBaselineEm = parseFloat(rs.getPropertyValue("--ko-baseline-em")) || 0;
  const enBaselineEm = parseFloat(rs.getPropertyValue("--en-baseline-em")) || 0;
  const overscanEm = parseFloat(rs.getPropertyValue("--line-overscan-em")) || 0;

  const overscanPx = baseSize * overscanEm;
  const yTop = ty + leading;

  ctx.save();
  ctx.beginPath();
  ctx.rect(tx, ty - overscanPx, tw, th + overscanPx * 2);
  ctx.clip();
  ctx.textBaseline = "top";
  ctx.fillStyle = cs.color || "#111";

  drawMixedRun(ctx, el.innerText, tx, yTop, tw, {
    weight,
    baseSize,
    koFamily,
    enFamily,
    koScale,
    enScale,
    koBaselineEm,
    enBaselineEm,
  });

  ctx.restore();
}

// ===== 이미지 cover 크롭 =====
function drawCoverImage(ctx, img, dx, dy, dWidth, dHeight) {
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const boxRatio = dWidth / dHeight;

  let sx, sy, sWidth, sHeight;
  if (imgRatio > boxRatio) {
    sHeight = img.naturalHeight;
    sWidth = sHeight * boxRatio;
    sx = (img.naturalWidth - sWidth) / 2;
    sy = 0;
  } else {
    sWidth = img.naturalWidth;
    sHeight = sWidth / boxRatio;
    sx = 0;
    sy = (img.naturalHeight - sHeight) / 2;
  }

  ctx.drawImage(img, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight);
}

// ===== 합성 (캔버스 렌더링) =====
async function renderToCanvas() {
  const rect = cardImg.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const s = getComputedStyle(document.documentElement);
  const cardW = parseFloat(s.getPropertyValue("--card-w"));
  const cardH = parseFloat(s.getPropertyValue("--card-h"));
  const holeX = parseFloat(s.getPropertyValue("--hole-x"));
  const holeY = parseFloat(s.getPropertyValue("--hole-y"));
  const holeW = parseFloat(s.getPropertyValue("--hole-w"));
  const holeH = parseFloat(s.getPropertyValue("--hole-h"));

  // 1) 사진 (cover 크롭)
  if (photoPrev.src) {
    const dx = rect.width * (holeX / cardW);
    const dy = rect.height * (holeY / cardH);
    const dw = rect.width * (holeW / cardW);
    const dh = rect.height * (holeH / cardH);
    drawCoverImage(ctx, photoPrev, dx, dy, dw, dh);
  }

  // 2) 카드 PNG
  await new Promise((res) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.src = cardImg.src;
    im.onload = () => {
      ctx.drawImage(im, 0, 0, rect.width, rect.height);
      res();
    };
    im.onerror = res;
  });

  // 3) 텍스트
  await ensureFonts();
  const lines = ["t1", "t2", "t3"];
  lines.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    const xPx = parseFloat(s.getPropertyValue(`--${id}-x`));
    const yPx = parseFloat(s.getPropertyValue(`--${id}-y`));
    const wPx = parseFloat(s.getPropertyValue("--t-w"));
    const hPx = parseFloat(s.getPropertyValue("--t-h"));

    const tx = rect.width * (xPx / cardW);
    let ty = rect.height * (yPx / cardH);
    const tw = rect.width * (wPx / cardW);
    const th = rect.height * (hPx / cardH);
    
 // 모바일 보정
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);
  if (isMobile) {
    ty -= 1;
  }
    
    drawOneLine(ctx, el, tx, ty, tw, th);
  });

  return canvas;
}

/* ===== 저장 ===== */
saveBtn.addEventListener("click", async () => {
  const c = await renderToCanvas();
  c.toBlob((blob) => {
 if (!blob) return;
    const url = URL.createObjectURL(blob);
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

    if (isMobile) {
      window.open(url, "_blank"); //mobile
      return;
    }

    // PC
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: "CC-IDCARD.png",
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, "image/png", 1);
});

/* ===== 트윗 공유 (Web Share → intent fallback) ===== */
tweetBtn.addEventListener("click", async () => {
  const c = await renderToCanvas();
  c.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], "CC-IDCARD.png", { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          text: " ˚𓂃 ⊹ I joined 𝗖𝗵𝗮𝗿𝗺𝗲𝗱 𝗖𝗵𝗮𝗿𝘁!  𓂂𓏸  ⁎ dwpmaze.com",
        });
        return;
      } catch (e) {}
    }

    window.open(
      "https://twitter.com/intent/tweet?text=" +
        encodeURIComponent(
          " ˚𓂃 ⊹ I joined 𝗖𝗵𝗮𝗿𝗺𝗲𝗱 𝗖𝗵𝗮𝗿𝘁!  𓂂𓏸  ⁎ dwpmaze.com"
        ),
      "_blank",
      "noopener"
    );

    // 폴백: 자동 저장해서 첨부 편하게
    const url = URL.createObjectURL(blob);
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

    if (isMobile) {
      window.open(url, "_blank"); // 모바일
      return;
    }

    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: "CC-IDCARD.png",
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, "image/png", 1);
});

/* ===== DOM 준비 후 폰트 로딩 ===== */
document.addEventListener("DOMContentLoaded", async () => {
  await ensureFonts();
  document.documentElement.classList.add("fonts-ready");
});
