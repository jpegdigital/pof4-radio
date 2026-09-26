import { afterEach, expect, it } from "vitest";
import { navigateRemote } from "./remote-navigation";

let root: HTMLDivElement;
afterEach(() => root?.remove());

function setup() {
  root = document.createElement("div");
  root.innerHTML = `<button class="player-play" style="position:fixed;left:20px;top:20px">Play</button>
    <button style="position:fixed;left:220px;top:20px">Program</button>
    <button disabled style="position:fixed;left:100px;top:20px">Unavailable</button>
    <button style="display:none">Hidden</button>
    <div role="slider" tabindex="0" style="position:fixed;left:20px;top:120px;width:100px;height:44px">Mix</div>`;
  document.body.append(root);
  return {
    play: root.querySelector<HTMLButtonElement>("button")!,
    program: root.querySelectorAll("button")[1],
    slider: root.querySelector<HTMLElement>('[role="slider"]')!,
  };
}

function key(value: string) {
  const event = new KeyboardEvent("keydown", { key: value, cancelable: true });
  navigateRemote(event, root);
  return event;
}

it("starts at transport, moves spatially, and skips disabled or hidden controls", () => {
  const { play, program, slider } = setup();
  key("ArrowDown");
  expect(document.activeElement).toBe(play);
  key("ArrowRight");
  expect(document.activeElement).toBe(program);
  key("ArrowLeft");
  expect(document.activeElement).toBe(play);
  key("ArrowDown");
  expect(document.activeElement).toBe(slider);
});

it("leaves horizontal scrubbing to sliders and allows vertical escape", () => {
  const { play, slider } = setup();
  slider.focus();
  expect(key("ArrowRight").defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(slider);
  key("ArrowUp");
  expect(document.activeElement).toBe(play);
});

it("does not hijack editing or a key already handled by a control", () => {
  const { play } = setup();
  const input = document.createElement("input");
  root.append(input);
  input.focus();
  expect(key("ArrowDown").defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(input);
  play.focus();
  const event = new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true });
  event.preventDefault();
  navigateRemote(event, root);
  expect(document.activeElement).toBe(play);
});
