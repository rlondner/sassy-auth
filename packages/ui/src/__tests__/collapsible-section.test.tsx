import * as React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CollapsibleSection } from "../components/ui/collapsible-section"

describe("CollapsibleSection", () => {
  it("renders children when open", () => {
    render(
      <CollapsibleSection title="Branding" open onOpenChange={() => undefined}>
        <p>Logo field</p>
      </CollapsibleSection>,
    )
    expect(screen.getByText("Logo field")).toBeVisible()
    expect(screen.getByRole("button", { name: "Branding" })).toHaveAttribute("aria-expanded", "true")
  })

  it("hides children when closed", () => {
    render(
      <CollapsibleSection title="Branding" open={false} onOpenChange={() => undefined}>
        <p>Logo field</p>
      </CollapsibleSection>,
    )
    expect(screen.queryByText("Logo field")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Branding" })).toHaveAttribute("aria-expanded", "false")
  })

  it("calls onOpenChange with the toggled value when the header is clicked", () => {
    const onOpenChange = jest.fn()
    render(
      <CollapsibleSection title="Branding" open={false} onOpenChange={onOpenChange}>
        <p>Logo field</p>
      </CollapsibleSection>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Branding" }))
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it("calls onOpenChange on Enter and Space keypresses", async () => {
    const user = userEvent.setup()

    const onEnterOpenChange = jest.fn()
    const { unmount } = render(
      <CollapsibleSection title="Branding" open onOpenChange={onEnterOpenChange}>
        <p>Logo field</p>
      </CollapsibleSection>,
    )
    screen.getByRole("button", { name: "Branding" }).focus()
    await user.keyboard("{Enter}")
    expect(onEnterOpenChange).toHaveBeenCalledWith(false)
    unmount()

    const onSpaceOpenChange = jest.fn()
    render(
      <CollapsibleSection title="Branding" open onOpenChange={onSpaceOpenChange}>
        <p>Logo field</p>
      </CollapsibleSection>,
    )
    screen.getByRole("button", { name: "Branding" }).focus()
    await user.keyboard(" ")
    expect(onSpaceOpenChange).toHaveBeenCalledWith(false)
  })
})
