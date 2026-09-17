import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiMarkdown } from "../AiMarkdown";

/** Garante que o texto de um item de lista fica ao lado do marcador. */
describe("AiMarkdown — listas", () => {
  it("lista solta (itens separados por linha em branco) não deixa quebra antes do texto", () => {
    const html = renderToStaticMarkup(
      <AiMarkdown>
        {"- **Zeppelin Old Bar:** música ao vivo.\n\n- **Bar do Zé:** mais tranquilo."}
      </AiMarkdown>,
    );
    const itens = html.match(/<li[^>]*>([\s\S]*?)<\/li>/g) ?? [];
    expect(itens).toHaveLength(2);
    for (const item of itens) {
      const conteudo = item.replace(/^<li[^>]*>/, "");
      expect(conteudo.startsWith("<p")).toBe(true);
    }
  });

  it("lista compacta continua com o texto direto no item", () => {
    const html = renderToStaticMarkup(<AiMarkdown>{"- um\n- dois"}</AiMarkdown>);
    expect(html).toMatch(/<li[^>]*>um<\/li>/);
    expect(html).toMatch(/<li[^>]*>dois<\/li>/);
  });
});
