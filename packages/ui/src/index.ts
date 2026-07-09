export { cn } from './lib/utils'

// shadcn primitives
export { Button, buttonVariants, type ButtonProps } from './components/ui/button'
export { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from './components/ui/button-group'
export { Badge, badgeVariants } from './components/ui/badge'
export { Input } from './components/ui/input'
export { Label } from './components/ui/label'
export {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectScrollDownButton, SelectScrollUpButton, SelectSeparator,
  SelectTrigger, SelectValue,
} from './components/ui/select'
export {
  Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter,
  SheetHeader, SheetOverlay, SheetPortal, SheetTitle, SheetTrigger,
} from './components/ui/sheet'
export {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger,
} from './components/ui/dialog'
export {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogOverlay, AlertDialogPortal, AlertDialogTitle, AlertDialogTrigger,
} from './components/ui/alert-dialog'
export {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent,
  DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuPortal, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from './components/ui/dropdown-menu'
export {
  Table, TableBody, TableCaption, TableCell, TableFooter,
  TableHead, TableHeader, TableRow,
} from './components/ui/table'
export {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupAction,
  SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInput,
  SidebarInset, SidebarMenu, SidebarMenuAction, SidebarMenuBadge,
  SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, SidebarMenuSub,
  SidebarMenuSubButton, SidebarMenuSubItem, SidebarProvider, SidebarRail,
  SidebarSeparator, SidebarTrigger, useSidebar,
} from './components/ui/sidebar'
export { Avatar, AvatarFallback, AvatarImage } from './components/ui/avatar'
export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './components/ui/card'
export {
  Breadcrumb, BreadcrumbEllipsis, BreadcrumbItem, BreadcrumbLink,
  BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from './components/ui/breadcrumb'
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip'
export { ScrollArea, ScrollBar } from './components/ui/scroll-area'
export { Separator } from './components/ui/separator'
export { Skeleton } from './components/ui/skeleton'

// Domain components (still hand-authored)
export { StatusChip } from './components/status-chip'
export { UserAvatar } from './components/user-avatar'
export { DataTable } from './components/data-table'
export { FormField } from './components/form-field'

// Backward-compat wrapper — kept so existing call sites and tests don't churn.
export { ConfirmDialog, type ConfirmDialogProps } from './components/confirm-dialog'

// Sheet body helper (used by drawers, not standard shadcn)
export { SheetBody } from './components/sheet-body'
