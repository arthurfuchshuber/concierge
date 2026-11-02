import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMarkdown } from "../ChatMarkdown";

/** Garante que o texto de um item de lista fica ao lado do marcador. */
describe("ChatMarkdown — listas", () => {
  it("lista solta (itens separados por linha em branco) não deixa quebra antes do texto", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown>
        {"- **Zeppelin Old Bar:** música ao vivo.\n\n- **Bar do Zé:** mais tranquilo."}
      </ChatMarkdown>,
    );
    const itens = html.match(/<li[^>]*>([\s\S]*?)<\/li>/g) ?? [];
    expect(itens).toHaveLength(2);
    for (const item of itens) {
      const conteudo = item.replace(/^<li[^>]*>/, "");
      expect(conteudo.startsWith("<p")).toBe(true);
    }
  });

  it("lista compacta continua com o texto direto no item", () => {
    const html = renderToStaticMarkup(<ChatMarkdown>{"- um\n- dois"}</ChatMarkdown>);
    expect(html).toMatch(/<li[^>]*>um<\/li>/);
    expect(html).toMatch(/<li[^>]*>dois<\/li>/);
  });
});
