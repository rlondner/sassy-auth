import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoginForm } from "../login-form";

jest.mock("react", () => {
  const originalReact = jest.requireActual("react");
  return {
    ...originalReact,
    useActionState: (action: any, initialState: any) => {
      const [state, setState] = originalReact.useState(initialState);
      const [isPending, setIsPending] = originalReact.useState(false);

      const formAction = async (...args: any[]) => {
        setIsPending(true);
        try {
          const result = await action(state, ...args);
          setState(result);
        } finally {
          setIsPending(false);
        }
      };

      return [state, formAction, isPending];
    },
  };
});

jest.mock("next-intl", () => ({
  useTranslations:
    (ns?: string) => (key: string, params?: Record<string, unknown>) => {
      const prefix = ns ? `${ns}.` : "";
      if (params) return `${prefix}${key}(${JSON.stringify(params)})`;
      return `${prefix}${key}`;
    },
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("../actions", () => ({
  signIn: jest.fn().mockResolvedValue({}),
}));

describe("LoginForm", () => {
  it("renders email and password fields, and show/hide password toggle button", () => {
    render(<LoginForm next="" />);
    expect(screen.getByLabelText("login.email")).toBeInTheDocument();
    expect(screen.getByLabelText("login.password")).toBeInTheDocument();

    // Toggle button should be present with correct initial show aria-label
    const toggleButton = screen.getByRole("button", {
      name: "login.showPassword",
    });
    expect(toggleButton).toBeInTheDocument();
  });

  it("toggles password visibility and updates aria-label on click", () => {
    render(<LoginForm next="" />);
    const passwordInput = screen.getByLabelText(
      "login.password",
    ) as HTMLInputElement;
    const toggleButton = screen.getByRole("button", {
      name: "login.showPassword",
    });

    // Initial state: password type
    expect(passwordInput.type).toBe("password");

    // Click to show password
    fireEvent.click(toggleButton);
    expect(passwordInput.type).toBe("text");
    expect(
      screen.getByRole("button", { name: "login.hidePassword" }),
    ).toBeInTheDocument();

    // Click again to hide password
    fireEvent.click(toggleButton);
    expect(passwordInput.type).toBe("password");
    expect(
      screen.getByRole("button", { name: "login.showPassword" }),
    ).toBeInTheDocument();
  });
});
