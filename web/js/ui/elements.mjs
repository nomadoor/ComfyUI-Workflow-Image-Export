export function createRow(labelText, inputElement, options = {}) {
  const row = document.createElement("div");
  row.className = "cwie-row";

  const label = document.createElement("label");
  label.textContent = labelText;

  const labelWrap = document.createElement("div");
  labelWrap.className = "cwie-row-label";
  labelWrap.appendChild(label);

  if (options.helpText) {
    const help = document.createElement("button");
    help.type = "button";
    help.className = "cwie-help";
    help.textContent = "?";
    help.setAttribute("data-help", options.helpText);
    help.setAttribute("aria-label", options.helpText);
    labelWrap.appendChild(help);
  }

  row.appendChild(labelWrap);
  row.appendChild(inputElement);

  return row;
}

export function createToggle() {
  const wrapper = document.createElement("label");
  wrapper.className = "cwie-toggle";

  const input = document.createElement("input");
  input.type = "checkbox";

  const slider = document.createElement("span");
  slider.className = "cwie-toggle-slider";

  wrapper.appendChild(input);
  wrapper.appendChild(slider);

  return { wrapper, input };
}

export function createRadioGroup(name, options) {
  const group = document.createElement("div");
  group.className = "cwie-radio-group";

  const inputs = new Map();

  for (const option of options) {
    const label = document.createElement("label");
    label.className = "cwie-radio";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = option.value;

    const text = document.createElement("span");
    text.textContent = option.label;

    label.appendChild(input);
    label.appendChild(text);
    group.appendChild(label);

    inputs.set(option.value, input);
  }

  return { group, inputs };
}

export function createCaretIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M3 4l3 3 3-3");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.5");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

export function createSelect(name, options) {
  const wrapper = document.createElement("details");
  wrapper.className = "cwie-select";
  wrapper.dataset.select = name;

  const summary = document.createElement("summary");
  summary.className = "cwie-select-summary";

  const labelGroup = document.createElement("span");
  labelGroup.className = "cwie-select-labels";

  options.forEach((option) => {
    const label = document.createElement("span");
    label.className = "cwie-select-label";
    label.dataset.value = option.value;
    label.textContent = option.label;
    labelGroup.appendChild(label);
  });

  const caret = document.createElement("span");
  caret.className = "cwie-caret";
  caret.appendChild(createCaretIcon());

  summary.appendChild(labelGroup);
  summary.appendChild(caret);

  const menu = document.createElement("div");
  menu.className = "cwie-select-options";

  const items = new Map();
  let currentValue = options[0]?.value ?? "";
  const changeHandlers = new Set();

  options.forEach((option) => {
    const optionLabel = document.createElement("label");
    optionLabel.className = "cwie-select-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = `cwie-select-${name}`;
    input.value = option.value;
    const text = document.createElement("span");
    text.textContent = option.label;
    optionLabel.appendChild(input);
    optionLabel.appendChild(text);
    items.set(option.value, input);
    menu.appendChild(optionLabel);
  });

  wrapper.appendChild(summary);
  wrapper.appendChild(menu);

  function setValue(value) {
    currentValue = value;
    const input = items.get(value);
    if (input) {
      input.checked = true;
    }
  }

  function getValue() {
    const checked = wrapper.querySelector("input[type=radio]:checked");
    return checked?.value ?? currentValue;
  }

  function onChange(handler) {
    changeHandlers.add(handler);
  }

  function setDisabled(disabled) {
    wrapper.toggleAttribute("data-disabled", disabled);
    wrapper.querySelectorAll("input").forEach((input) => {
      input.disabled = disabled;
    });
  }

  wrapper.addEventListener("change", (event) => {
    if (event.target && event.target.matches("input[type=radio]")) {
      currentValue = event.target.value;
      changeHandlers.forEach((handler) => handler(currentValue));
      wrapper.removeAttribute("open");
    }
  });

  setValue(currentValue);

  return {
    root: wrapper,
    setValue,
    getValue,
    onChange,
    setDisabled,
  };
}
