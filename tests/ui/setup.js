import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(()=>cleanup());
globalThis.confirm = vi.fn(()=>true);
globalThis.URL.createObjectURL = globalThis.URL.createObjectURL || vi.fn(()=>"blob:test");
globalThis.URL.revokeObjectURL = globalThis.URL.revokeObjectURL || vi.fn();
globalThis.__BUILD__='test';
