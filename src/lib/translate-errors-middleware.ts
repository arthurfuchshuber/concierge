/**
 * Middleware global: todo erro lançado por uma função de servidor chega ao
 * navegador como UMA frase clara em português (ver `friendly-error.ts`).
 * Respostas prontas (401, redirect, notFound) passam intactas.
 */
import { createMiddleware } from "@tanstack/react-start";
import { friendlyErrorMessage } from "./friendly-error";

export const translateServerErrors = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error && typeof error === "object" && ("statusCode" in error || "isNotFound" in error || "isRedirect" in error || "href" in error)) {
      throw error;
    }
    throw new Error(friendlyErrorMessage(error));
  }
});
