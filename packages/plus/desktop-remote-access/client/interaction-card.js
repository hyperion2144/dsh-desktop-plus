//! 交互卡片（#151）：A 上的提问 / 审批在远程会话里显示成一张卡片，用户的回答经本机宿主交回 A。
//!
//! 镜像会话上不留本机 agent（见 remote-gate.js 的说明），官方提问界面不会为它出现，所以由插件自己渲染。
//! 这里只做三件事：把宿主给的交互整理成视图模型、把用户的选择整理成回答、在输入区上方渲染卡片。
//! 不碰网络：取交互与交回答案都由装配处（client.source.jsx）经宿主完成。

/** 文案（中文界面；不用 emoji）。 */
export const COPY = {
  questionTitle: "来自设备本机的提问",
  approvalTitle: "需要你确认",
  approve: "允许一次",
  reject: "拒绝",
  skip: "跳过",
  submit: "提交回答",
  customPlaceholder: "其他（可选，自由填写）",
  handedBack: "这一项已经交回设备本机处理。",
  approvalQuestion: (toolName) => `是否允许执行「${toolName}」？`,
  approveDescription: (toolName) => `只允许这一次：${toolName}`,
  rejectDescription: "不执行这一步",
  submitBusy: "正在送达…",
};

/** 卡片的一张「题目」的视图模型。 */
export function questionModel(question) {
  return {
    id: question.id,
    header: typeof question.header === "string" ? question.header : "",
    question: typeof question.question === "string" ? question.question : "",
    detail: typeof question.detail === "string" ? question.detail : "",
    multiSelect: question.multiSelect === true,
    options: Array.isArray(question.options)
      ? question.options
          .map((option) => ({ label: option?.label, description: typeof option?.description === "string" ? option.description : "" }))
          .filter((option) => typeof option.label === "string" && option.label !== "")
      : [],
  };
}

/**
 * 把宿主给的交互整理成视图模型。
 * @param interaction 宿主返回的一条待回答交互。
 * @returns 视图模型：种类、标题、题目或审批信息、是否已交回设备本机。
 */
export function cardModel(interaction) {
  const handedBack = interaction?.handedBack === true;
  if (interaction?.type === "approval") {
    const toolName = typeof interaction.toolName === "string" ? interaction.toolName : "";
    return {
      requestId: interaction.requestId,
      kind: "approval",
      handedBack,
      title: COPY.approvalTitle,
      toolName,
      reason: typeof interaction.reason === "string" && interaction.reason !== "" ? interaction.reason : COPY.approvalQuestion(toolName),
    };
  }
  const questions = Array.isArray(interaction?.questions) ? interaction.questions : [];
  return {
    requestId: interaction?.requestId ?? "",
    kind: "question",
    handedBack,
    title: COPY.questionTitle,
    questions: questions.map(questionModel),
  };
}

/**
 * 当前打开的远程会话该显示哪一张卡片：一次只显示一张，按宿主给出的先后顺序取第一张。
 * @param interactions 宿主返回的待回答交互列表。
 * @param sessionId 当前打开的会话 id。
 * @returns 要显示的交互；没有时返回 null。
 */
export function cardForSession(interactions, sessionId) {
  if (!Array.isArray(interactions) || typeof sessionId !== "string" || sessionId === "") return null;
  return interactions.find((item) => item?.sessionId === sessionId && typeof item.requestId === "string") ?? null;
}

/** 读取一个选项按钮是否处于选中状态。 */
function selectedLabels(node) {
  return Array.from(node.querySelectorAll("button[data-option][aria-pressed='true']")).map((button) => button.getAttribute("data-option") || "");
}

/**
 * 依据卡片上的选择生成提问的回答。
 * @param model 卡片视图模型。
 * @param root 卡片根元素。
 * @param skip 是否跳过（每题都不选、不填）。
 * @returns 与官方回答同形的对象。
 */
export function buildQuestionAnswer(model, root, skip = false) {
  const answers = model.questions.map((question) => {
    const field = root.querySelector(`[data-question='${question.id}']`);
    const custom = skip ? "" : (field?.querySelector("input[data-custom]")?.value ?? "").trim();
    const selected = skip || question.multiSelect !== true && custom !== "" ? [] : (field ? selectedLabels(field) : []);
    return { id: question.id, selected, ...(custom === "" ? {} : { custom }) };
  });
  return { type: "question", requestId: model.requestId, answer: { answers } };
}

/**
 * 生成审批的回答。
 * @param model 卡片视图模型。
 * @param outcome "allowed-once" 或 "rejected"。
 * @returns 与宿主约定同形的回答。
 */
export function buildApprovalAnswer(model, outcome) {
  return { type: "approval", requestId: model.requestId, outcome };
}

/** 卡片的内联样式：只用中性值与主题变量的回退，不引入样式表。 */
function styles() {
  const card = {
    "border": "1px solid var(--dsh-border-color, rgba(128,128,128,0.35))",
    "border-radius": "10px",
    "padding": "10px 12px",
    "margin": "0 0 8px",
    "font": "inherit",
    "color": "inherit",
    "background": "var(--dsh-bg-elevated, transparent)",
    "display": "flex",
    "flex-direction": "column",
    "gap": "8px",
  };
  const title = { "font-weight": "600", "font-size": "13px", "margin": "0" };
  const muted = { "font-size": "12px", "opacity": "0.8", "margin": "0" };
  const question = { "display": "flex", "flex-direction": "column", "gap": "6px" };
  const label = { "font-size": "13px", "margin": "0" };
  const options = { "display": "flex", "flex-wrap": "wrap", "gap": "6px" };
  const button = {
    "font": "inherit",
    "font-size": "12px",
    "padding": "4px 10px",
    "border-radius": "999px",
    "border": "1px solid var(--dsh-border-color, rgba(128,128,128,0.35))",
    "background": "transparent",
    "color": "inherit",
    "cursor": "pointer",
  };
  const primary = { ...button, "border-color": "transparent", "background": "var(--dsh-accent, #3b6ef5)", "color": "#fff" };
  const input = { "font": "inherit", "font-size": "12px", "padding": "4px 8px", "border-radius": "6px", "border": "1px solid var(--dsh-border-color, rgba(128,128,128,0.35))", "background": "transparent", "color": "inherit" };
  const actions = { "display": "flex", "gap": "8px", "justify-content": "flex-end" };
  return { card, title, muted, question, label, options, button, primary, input, actions };
}

function apply(node, style) {
  for (const [key, value] of Object.entries(style)) node.style.setProperty(key, value);
  return node;
}

function el(tag, text, style) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (style !== undefined) apply(node, style);
  return node;
}

function button(text, style, onClick) {
  const node = el("button", text, style);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

/** 切换一个选项按钮的选中态；单选题先把同题的其它按钮清掉。 */
function toggleOption(target, multiSelect) {
  const pressed = target.getAttribute("aria-pressed") === "true";
  if (!multiSelect) {
    for (const other of target.parentElement?.querySelectorAll("button[data-option]") ?? []) other.setAttribute("aria-pressed", "false");
  }
  target.setAttribute("aria-pressed", pressed ? "false" : "true");
  for (const other of target.parentElement?.querySelectorAll("button[data-option]") ?? []) {
    apply(other, other.getAttribute("aria-pressed") === "true" ? styles().primary : styles().button);
  }
}

/**
 * 在输入区上方渲染一张交互卡片。
 * @param composer 输入框元素（卡片插在它所在容器的最前面）；找不到时返回 null。
 * @param model 卡片视图模型。
 * @param handlers.onAnswer 用户给出回答时调用（参数是与宿主约定同形的回答）。
 * @returns 卡片的卸载函数。
 */
export function mountInteractionCard(composer, model, handlers) {
  const host = composer?.parentElement;
  if (!host || model.requestId === "") return null;
  const s = styles();
  const root = document.createElement("div");
  root.setAttribute("data-dsh-remote-interaction", model.requestId);
  apply(root, s.card);
  root.appendChild(el("p", model.title, s.title));
  if (model.handedBack) {
    root.appendChild(el("p", COPY.handedBack, s.muted));
  } else if (model.kind === "approval") {
    root.appendChild(el("p", model.reason, s.label));
    if (model.toolName !== "") root.appendChild(el("p", model.toolName, s.muted));
    const actions = el("div", undefined, s.actions);
    actions.appendChild(button(COPY.reject, s.button, () => handlers.onAnswer(buildApprovalAnswer(model, "rejected"))));
    actions.appendChild(button(COPY.approve, s.primary, () => handlers.onAnswer(buildApprovalAnswer(model, "allowed-once"))));
    root.appendChild(actions);
  } else {
    for (const question of model.questions) {
      const field = el("div", undefined, s.question);
      field.setAttribute("data-question", question.id);
      if (question.header !== "") field.appendChild(el("p", question.header, s.muted));
      field.appendChild(el("p", question.question, s.label));
      if (question.detail !== "") field.appendChild(el("p", question.detail, s.muted));
      if (question.options.length > 0) {
        const options = el("div", undefined, s.options);
        for (const option of question.options) {
          const node = button(option.label, s.button, (event) => toggleOption(event.currentTarget, question.multiSelect));
          node.setAttribute("data-option", option.label);
          node.setAttribute("aria-pressed", "false");
          if (option.description !== "") node.title = option.description;
          options.appendChild(node);
        }
        field.appendChild(options);
      }
      if (question.options.length === 0 || !question.multiSelect) {
        const input = el("input", undefined, s.input);
        input.setAttribute("data-custom", "");
        input.placeholder = COPY.customPlaceholder;
        field.appendChild(input);
      }
      root.appendChild(field);
    }
    const actions = el("div", undefined, s.actions);
    actions.appendChild(button(COPY.skip, s.button, () => handlers.onAnswer(buildQuestionAnswer(model, root, true))));
    actions.appendChild(button(COPY.submit, s.primary, () => handlers.onAnswer(buildQuestionAnswer(model, root, false))));
    root.appendChild(actions);
  }
  host.insertBefore(root, host.firstChild);
  return () => { root.remove(); };
}
