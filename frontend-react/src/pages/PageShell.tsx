type PageShellProps = {
  title: string;
  description: string;
};

export default function PageShell({ title, description }: PageShellProps) {
  return (
    <section style={{ padding: '24px 0' }}>
      <h1 style={{ margin: '0 0 8px', fontSize: '2rem' }}>{title}</h1>
      <p style={{ margin: 0, color: '#4b5563' }}>{description}</p>
    </section>
  );
}
