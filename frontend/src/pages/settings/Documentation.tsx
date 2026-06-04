import { Link } from "react-router-dom";
import Card from "../../components/ui/Card";
import { DOCUMENTATION_PAGES, getDocumentationCategories } from "../../api/documentation";

export default function Documentation() {
  const categories = getDocumentationCategories();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documentation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Static usage and configuration documentation for the platform.
        </p>
      </div>

      <div className="space-y-6">
        {categories.map((category) => {
          const pages = DOCUMENTATION_PAGES.filter((page) => page.category === category);

          return (
            <section key={category} className="space-y-3">
              <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                {category}
              </h2>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {pages.map((page) => (
                  <Link
                    key={page.slug}
                    to={`/settings/documentation/${page.slug}`}
                    className="block"
                  >
                    <Card className="h-full rounded-2xl border border-border bg-card p-5 transition hover:border-foreground/20 hover:shadow-sm">
                      <div className="space-y-2">
                        <div className="text-base font-semibold">{page.title}</div>
                        <p className="text-sm text-muted-foreground">{page.summary}</p>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}