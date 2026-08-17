// Máscara de moeda (R$) para campos de valor. O usuário digita só números,
// como numa calculadora, e o campo formata sozinho enquanto digita.
const formatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function bindCurrencyInput(input) {
  function digitsToNumber(digits) {
    return digits ? Number(digits) / 100 : 0;
  }

  function handleInput() {
    const digits = input.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    input.value = digits ? formatter.format(digitsToNumber(digits)) : "";
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event("currencychange"));
  }

  input.addEventListener("input", handleInput);
  input.addEventListener("focus", () => input.setSelectionRange(input.value.length, input.value.length));

  return {
    setValue(value) {
      input.value = value === null || value === undefined ? "" : formatter.format(value);
    },
    getValue() {
      const digits = input.value.replace(/\D/g, "");
      return digits ? digitsToNumber(digits) : null;
    },
  };
}
