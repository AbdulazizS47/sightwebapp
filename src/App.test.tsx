import { render, screen } from '@testing-library/react';
import App from './App';

it('renders sign-in control in the top bar', () => {
  render(<App />);
  const signInLabel = screen.getByText(/Sign In|تسجيل الدخول/);
  expect(signInLabel).toBeInTheDocument();
});