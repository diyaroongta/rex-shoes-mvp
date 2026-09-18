import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(()=>cleanup());
globalThis.confirm = vi.fn(()=>true);
globalThis.URL.createObjectURL = globalThis.URL.createObjectURL || vi.fn(()=>"blob:test");
globalThis.URL.revokeObjectURL = globalThis.URL.revokeObjectURL || vi.fn();
/* jsdom implements no scrolling, so scrollIntoView does not exist on an
   element. The app calls it to bring a refusal into view — a real behaviour
   worth keeping — and without this stub any test that surfaces an error dies
   in the effect rather than on the assertion it was written for. */
globalThis.Element.prototype.scrollIntoView =
  globalThis.Element.prototype.scrollIntoView || function(){};
globalThis.__BUILD__='test';
