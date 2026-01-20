export const NODE2_UNSUPPORTED_CODE = "NODE2_UNSUPPORTED";

export async function captureNode2() {
  const error = new Error("Node2.0にはまだ対応していません。");
  error.code = NODE2_UNSUPPORTED_CODE;
  throw error;
}

