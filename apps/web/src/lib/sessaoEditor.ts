export type SessaoEditor =
  | { etapa: "upload"; projetoId: string }
  | { etapa: "questionario" | "editor"; projetoId: string; plantaId: string };

const CHAVE_SESSAO_EDITOR = "gerador-croqui:sessao-editor:v1";

export function lerSessaoEditor(): SessaoEditor | null {
  try {
    const valor = window.localStorage.getItem(CHAVE_SESSAO_EDITOR);
    if (!valor) return null;

    const sessao: unknown = JSON.parse(valor);
    if (!sessao || typeof sessao !== "object") return null;

    const registro = sessao as Record<string, unknown>;
    if (registro.etapa === "upload" && typeof registro.projetoId === "string") {
      return { etapa: "upload", projetoId: registro.projetoId };
    }

    if (
      (registro.etapa === "questionario" || registro.etapa === "editor") &&
      typeof registro.projetoId === "string" &&
      typeof registro.plantaId === "string"
    ) {
      return {
        etapa: registro.etapa,
        projetoId: registro.projetoId,
        plantaId: registro.plantaId,
      };
    }
  } catch {
    // Uma sessão corrompida não deve impedir a abertura do aplicativo.
  }

  return null;
}

export function salvarSessaoEditor(sessao: SessaoEditor): void {
  try {
    window.localStorage.setItem(CHAVE_SESSAO_EDITOR, JSON.stringify(sessao));
  } catch {
    // O editor continua funcionando mesmo se o navegador bloquear o storage.
  }
}

export function limparSessaoEditor(): void {
  try {
    window.localStorage.removeItem(CHAVE_SESSAO_EDITOR);
  } catch {
    // Não há ação adicional necessária.
  }
}
