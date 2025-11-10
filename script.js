/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const generateBtn = document.getElementById("generateRoutine");
const clearBtn = document.getElementById("clearSelections");
const searchInput = document.getElementById("searchInput");

/* Worker URL: set this in `secrets.js` as `window.WORKER_URL = 'https://your-worker.workers.dev'`
  or replace the string below. This keeps the API key on Cloudflare only. */
let WORKER_URL =
  window.WORKER_URL || "https://loreal-worker.dombish.workers.dev/";
// If user provided hostname without scheme, assume HTTPS so fetch calls are correct
if (
  WORKER_URL &&
  !WORKER_URL.startsWith("http://") &&
  !WORKER_URL.startsWith("https://")
) {
  WORKER_URL = `https://${WORKER_URL}`;
}

// --- Product selection handling ---
// Clicking a card toggles its selection. Selected IDs tracked in window._selectedIds.
productsContainer.addEventListener("click", (e) => {
  // ignore clicks on buttons (those have separate handlers)
  if (e.target.closest(".btn")) return;

  const card = e.target.closest(".container.card-theme");
  if (!card) return;
  const id = card.dataset.id;
  toggleProductSelection(id, card);
});

const selectedList = document.getElementById("selectedProductsList");
// allow removing by clicking mini cards
selectedList.addEventListener("click", (e) => {
  const mini = e.target.closest(".selected-mini");
  if (!mini) return;
  const id = mini.dataset.id;
  // remove selection
  removeProductSelection(id);
});

function toggleProductSelection(id, cardEl) {
  if (!window._productsCache) return;
  const pid = String(id);
  const product = window._productsCache.find((p) => String(p.id) === pid);
  if (!product) return;

  if (window._selectedIds.has(pid)) {
    removeProductSelection(pid, cardEl);
  } else {
    window._selectedIds.add(pid);
    if (cardEl) cardEl.classList.add("selected");
    addSelectedMini(product);
    // persist
    saveSelectedIds();
  }
}

function removeProductSelection(id, cardEl) {
  const pid = String(id);
  if (!window._selectedIds.has(pid)) return;
  window._selectedIds.delete(pid);
  // remove selected marker on main card
  const mainCard = productsContainer.querySelector(
    `.container.card-theme[data-id="${pid}"]`
  );
  if (mainCard) mainCard.classList.remove("selected");
  // remove mini card
  const mini = selectedList.querySelector(`.selected-mini[data-id="${pid}"]`);
  if (mini && mini.parentNode) mini.parentNode.removeChild(mini);
  // persist
  saveSelectedIds();
}

function addSelectedMini(product) {
  // don't add duplicates
  const pid = String(product.id);
  if (selectedList.querySelector(`.selected-mini[data-id="${pid}"]`)) return;

  const mini = document.createElement("div");
  mini.className = "selected-mini";
  mini.dataset.id = pid;
  mini.innerHTML = `
    <div class="mini-card">
      <div class="mini-image" style="background-image: url('${encodeURI(
        product.image
      )}')"></div>
      <div class="mini-name">${escapeHtml(product.name)}</div>
    </div>
  `;
  selectedList.appendChild(mini);
  // when adding a mini programmatically, ensure storage updated (no-op if already saved)
  saveSelectedIds();
}

/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category to view products
  </div>
`;

/* System-level instruction sent to the model to act as a L'Oréal specialist. */
const systemMessage = {
  role: "system",
  content: `Act as a L’Oréal Specialist who is highly knowledgeable about L’Oréal’s entire product range—including makeup, skincare, haircare, and fragrances. Your primary goal is to provide expert, personalized beauty routines and product recommendations tailored to each user's needs, concerns, or preferences, strictly using L’Oréal products. Always ensure your answers are accurate, informative, and up-to-date with L’Oréal’s offerings.

Politely and firmly refuse to answer any questions unrelated to L’Oréal products, routines, recommendations, or beauty-related topics. Direct users back to relevant L’Oréal or beauty topics if they inquire about something else.

For each user request:
- Gather any relevant information about the user’s preferences, skin/hair type, goals, and routines if not already provided.
- Clearly reason about the user’s needs and how different products or routines apply before making a recommendation.
- Only after reasoning, provide your specific product and/or routine recommendations.
- If the request is not about L’Oréal or beauty, respond courteously with a brief, polite refusal and guide the conversation back to beauty.

Persist until you have all needed information; reason step-by-step internally before finalizing your answer.

Output Format: Respond in friendly, informative, medium-length paragraphs. Use clear and polite language. If suggesting multiple products or steps, use bullet points or numbered lists for clarity.`,
};

// Guidance to enforce concise replies (helps prevent server-side truncation)
systemMessage.content += `\n\nKeep responses concise and focused: aim for roughly 2–4 short sentences or a brief bulleted list. Limit outputs to about 250 tokens and avoid overly verbose explanations unless the user explicitly asks for more detail.`;

/* Initialize conversation with the system message so the worker forwards it to OpenAI */
const messages = [systemMessage];

/* Utility: escape HTML to safely insert product descriptions into card markup */
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Load product data from JSON file */
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  return data.products;
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  productsContainer.innerHTML = products
    .map((product) => {
      const descHtml = escapeHtml(product.description).replace(/\n/g, "<br/>");
      return `
    <div class="container card-theme" data-id="${product.id}">
      <div class="wrapper">
        <div class="banner-image" style="background-image: url('${encodeURI(
          product.image
        )}')"></div>
        <h1>${escapeHtml(product.name)}</h1>
        <div class="desc-overlay" aria-hidden="true">
          <div class="desc-inner">${descHtml}</div>
        </div>
      </div>
    </div>
  `;
    })
    .join("");

  // mark cards as selected if they are in the saved selection set
  if (window._selectedIds && window._selectedIds.size > 0) {
    Array.from(window._selectedIds).forEach((sid) => {
      const card = productsContainer.querySelector(
        `.container.card-theme[data-id="${sid}"]`
      );
      if (card) card.classList.add("selected");
    });
  }
}

// Button handlers (event delegation) for DETAILS / BUY NOW
productsContainer.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn");
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  const product = window._productsCache?.find(
    (p) => String(p.id) === String(id)
  );

  if (action === "details") {
    if (product) {
      alert(`${product.name} - ${product.brand}\n\n${product.description}`);
    } else alert("Product details not available.");
  }

  if (action === "buy") {
    // Placeholder: open product image in new tab as a stub for buying
    if (product) window.open(product.image, "_blank");
    else alert("Buy action not configured.");
  }
});

// Cache products so handlers can access data
async function loadAndCacheProducts() {
  const products = await loadProducts();
  window._productsCache = products;
  // initialize selection set from localStorage (if any)
  const saved = JSON.parse(localStorage.getItem("selectedProductIds") || "[]");
  window._selectedIds = new Set((saved || []).map(String));

  // restore selected mini cards from saved IDs
  if (window._selectedIds.size > 0) {
    Array.from(window._selectedIds).forEach((sid) => {
      const prod = products.find((p) => String(p.id) === String(sid));
      if (prod) addSelectedMini(prod);
    });
  }
  return products;
}

// Persist selected ids helper
function saveSelectedIds() {
  try {
    const arr = Array.from(window._selectedIds || []);
    localStorage.setItem("selectedProductIds", JSON.stringify(arr));
  } catch (e) {
    console.error("Failed to save selected IDs", e);
  }
}

// Clear all selections helper
function clearAllSelections() {
  if (!window._selectedIds) window._selectedIds = new Set();
  // remove selected class from main cards
  window._selectedIds.forEach((sid) => {
    const mainCard = productsContainer.querySelector(
      `.container.card-theme[data-id="${sid}"]`
    );
    if (mainCard) mainCard.classList.remove("selected");
  });
  // clear set, DOM, and storage
  window._selectedIds.clear();
  selectedList.innerHTML = "";
  localStorage.removeItem("selectedProductIds");
}

// wire clear button if present
if (clearBtn) {
  clearBtn.addEventListener("click", (e) => {
    e.preventDefault();
    clearAllSelections();
  });
}

/* Filter and display products when category changes */
categoryFilter.addEventListener("change", (e) => {
  // category change -> recompute the displayed set using current search
  updateDisplayedProducts();
});

// Debounce helper so searching isn't firing on every keystroke
function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function updateDisplayedProducts() {
  // ensure products are loaded
  if (!window._productsCache) {
    await loadAndCacheProducts();
  }

  const products = window._productsCache || [];
  const selectedCategory = categoryFilter?.value || "";
  const q = (searchInput?.value || "").trim().toLowerCase();

  let filtered = products;
  if (selectedCategory) {
    filtered = filtered.filter((p) => p.category === selectedCategory);
  }

  if (q) {
    filtered = filtered.filter((p) => {
      const hay = `${p.name} ${p.brand || ""} ${
        p.description || ""
      }`.toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  if (!filtered || filtered.length === 0) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">No products match your search</div>
    `;
    return;
  }

  displayProducts(filtered);
}

// wire search input (debounced)
if (searchInput) {
  searchInput.addEventListener(
    "input",
    debounce(() => {
      updateDisplayedProducts();
    }, 200)
  );
}
// on initial load, cache products (so the UI handlers can access them later)
loadAndCacheProducts().then((products) => {
  // do nothing here; products will load when a category is chosen
  // but if there's already a search term (unlikely) we can populate
  if (searchInput && searchInput.value.trim()) updateDisplayedProducts();
});

// Generate Routine button: collect selected products and ask the model
if (generateBtn) {
  generateBtn.addEventListener("click", async (e) => {
    e.preventDefault();

    if (!window._selectedIds || window._selectedIds.size === 0) {
      appendMessage(
        "assistant",
        "Please select one or more products before generating a routine."
      );
      return;
    }

    const products = window._productsCache || [];
    const selected = Array.from(window._selectedIds)
      .map((id) => products.find((p) => String(p.id) === String(id)))
      .filter(Boolean)
      .map((p) => ({
        name: p.name,
        brand: p.brand,
        category: p.category,
        description: p.description,
      }));

    if (selected.length === 0) {
      appendMessage(
        "assistant",
        "Unable to find details for selected products. Try reloading the page."
      );
      return;
    }

    // Prepare a clear user message that includes the selected products as JSON
    const prompt = `Generate a personalized, step-by-step routine using ONLY the following selected L'Oréal products. Use the product name, brand, category, and description to determine where each product belongs in the routine (order, frequency, AM/PM, and any pairing / layering notes). If additional user info is required (skin type, sensitivities, goals), ask one concise clarifying question before giving the routine. Output the routine in short numbered steps and include brief rationale for each step.

Products JSON:\n${JSON.stringify(selected, null, 2)}\n
Keep the response concise and user-friendly.`;

    // push the user prompt into the conversation history so follow-ups keep context
    messages.push({ role: "user", content: prompt });

    // show a thinking indicator in the chat
    const thinkingEl = document.createElement("div");
    thinkingEl.className = "chat-message chat-assistant thinking";
    thinkingEl.textContent = "Generating routine...";
    chatWindow.appendChild(thinkingEl);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    // disable the button while generating
    generateBtn.disabled = true;

    try {
      if (WORKER_URL === "REPLACE_WITH_YOUR_WORKER_URL") {
        throw new Error(
          "Please configure your Cloudflare Worker URL in `secrets.js` as window.WORKER_URL or replace WORKER_URL in script.js"
        );
      }

      const resp = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => null);
        const errMsg =
          errBody?.error?.message ||
          errBody?.message ||
          `Worker error ${resp.status}`;
        throw new Error(errMsg);
      }

      const data = await resp.json();
      const assistantText =
        data?.choices?.[0]?.message?.content ||
        data?.error?.message ||
        "No response";

      thinkingEl.remove();
      appendMessage("assistant", assistantText);
      messages.push({ role: "assistant", content: assistantText });
    } catch (err) {
      thinkingEl.remove();
      appendMessage("assistant", "Error: " + err.message);
      console.error(err);
    } finally {
      generateBtn.disabled = false;
    }
  });
}

/* Very small chat client that forwards messages to a Cloudflare Worker which
  holds the OpenAI API key. The `messages` array is initialized above with
  a system message so the model receives the specialist instructions. */

function appendMessage(role, text) {
  const el = document.createElement("div");
  el.className = `chat-message chat-${role}`;
  el.textContent = text;
  chatWindow.appendChild(el);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const input = document.getElementById("userInput");
  const userText = input.value.trim();
  if (!userText) return;

  // show user message locally
  appendMessage("user", userText);
  messages.push({ role: "user", content: userText });
  input.value = "";

  // show a temporary thinking message
  const thinkingEl = document.createElement("div");
  thinkingEl.className = "chat-message chat-assistant thinking";
  thinkingEl.textContent = "Thinking...";
  chatWindow.appendChild(thinkingEl);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  try {
    if (WORKER_URL === "REPLACE_WITH_YOUR_WORKER_URL") {
      throw new Error(
        "Please configure your Cloudflare Worker URL in `secrets.js` as window.WORKER_URL or replace WORKER_URL in script.js"
      );
    }

    const resp = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });

    if (!resp.ok) {
      // Try to parse the worker's JSON error to show a helpful message
      const errBody = await resp.json().catch(() => null);
      const errMsg =
        errBody?.error?.message ||
        errBody?.message ||
        `Worker error ${resp.status}`;
      throw new Error(errMsg);
    }

    const data = await resp.json();

    // The worker proxies the OpenAI response object. Extract assistant text.
    const assistantText =
      data?.choices?.[0]?.message?.content ||
      data?.error?.message ||
      "No response";

    // remove thinking
    thinkingEl.remove();

    appendMessage("assistant", assistantText);
    messages.push({ role: "assistant", content: assistantText });
  } catch (err) {
    thinkingEl.remove();
    appendMessage("assistant", "Error: " + err.message);
    console.error(err);
  }
});

// Splash overlay behavior: require an explicit button press to enter the site
// Elements
const splash = document.getElementById("splash");
const enterBtn = document.getElementById("enterBtn");
const userInput = document.getElementById("userInput"); // optional - used to focus main input after dismiss

// If the splash exists, mark the body so scrolling can be locked via CSS
if (splash) {
  document.body.classList.add("splash-active");
}

function hideSplash() {
  if (!splash) return;
  // remove the body lock first so no scroll artifacts remain after hiding
  document.body.classList.remove("splash-active");
  splash.classList.add("hidden");
  // remove from DOM after transition so it doesn't block tab/focus
  setTimeout(() => {
    if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
    // focus the chat input after splash removed (if present)
    if (userInput) userInput.focus();
  }, 600);
}

if (splash) {
  // Only the Enter button dismisses the splash. Do NOT dismiss on overlay click or auto-dismiss.
  enterBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    hideSplash();
  });
}
