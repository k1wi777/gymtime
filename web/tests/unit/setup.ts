import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetNav } from './navigation-mock';
import { installFakeEventSource } from './helpers';

// The browser API base URL used by the panel code under test.
process.env.NEXT_PUBLIC_API_URL = 'http://api.test';

vi.mock('next/navigation', () => import('./navigation-mock'));

// jsdom has no <dialog> behaviour: model what the panel relies on.
const dialog = HTMLDialogElement.prototype as unknown as {
  showModal?: (this: HTMLDialogElement) => void;
  close?: (this: HTMLDialogElement) => void;
};
dialog.showModal ??= function () {
  this.setAttribute('open', '');
};
dialog.close ??= function () {
  this.removeAttribute('open');
};

// jsdom has no EventSource. The fake is installed for every test and never
// removed: a late effect (an async mount finishing after its test) must still
// find it, or it would throw depending on timing.
beforeEach(() => {
  resetNav();
  installFakeEventSource();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
