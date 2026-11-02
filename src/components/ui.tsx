"use client";

import type { ReactNode } from "react";

/** 단계 제목. 단계마다 한 번만 쓴다 */
export function StepHeader({ id, title, description, aside }: { id: string; title: string; description?: string; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="max-w-2xl">
        <h2 id={`${id}-title`} className="font-serif text-[1.625rem] leading-tight font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        {description && <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">{description}</p>}
      </div>
      {aside}
    </div>
  );
}

/** 흰 종이 한 장. 같은 단계 안에서 내용을 나눌 때 */
export function Panel({
  title,
  children,
  className = "",
  ...props
}: { title?: ReactNode; children: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section {...props} className={`rounded-xl border border-line bg-surface p-5 sm:p-6 ${className}`}>
      {title && <h3 className="mb-4 text-base font-semibold">{title}</h3>}
      {children}
    </section>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost"; size?: "md" | "lg" }) {
  const styles = {
    primary: "bg-ink text-surface hover:opacity-90 disabled:opacity-35",
    secondary: "border border-line bg-surface text-ink hover:border-ink/40 disabled:opacity-45",
    ghost: "text-accent hover:bg-soft disabled:opacity-45",
  }[variant];
  const sizes = { md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-[0.9375rem]" }[size];
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-semibold transition-[opacity,background-color,border-color] disabled:cursor-not-allowed ${sizes} ${styles} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="mt-4 flex flex-col gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger sm:flex-row sm:items-center sm:justify-between"
    >
      <span>{message}</span>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="text-ink">
          다시 시도
        </Button>
      )}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <p role="status" aria-live="polite" className="mt-4 flex items-center gap-2.5 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden />
      {label}
    </p>
  );
}

export function FieldHint({ id, children, tone = "muted" }: { id?: string; children: ReactNode; tone?: "muted" | "error" }) {
  return (
    <p id={id} className={`mt-1.5 text-[0.8125rem] leading-relaxed ${tone === "error" ? "text-danger" : "text-muted"}`}>
      {children}
    </p>
  );
}

export const fieldClass =
  "w-full rounded-lg border border-line bg-surface px-3.5 py-3 text-[0.9375rem] leading-relaxed placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50 aria-[invalid=true]:border-danger";
