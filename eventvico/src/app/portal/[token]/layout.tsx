export default function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Portal uses serif headings via font-serif applied to child components
  return <div className="min-h-screen bg-white">{children}</div>
}
