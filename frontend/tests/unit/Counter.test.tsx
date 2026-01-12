import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import App from '../../src/App.tsx';

describe('Counter', () => {
  it('starts with 0', () => {
    render(<App />);

    expect(screen.getByRole('button')).toHaveTextContent('0');
  });

  it('increments on click', async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toHaveTextContent('1');
  });
});
