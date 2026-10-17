// Compiles and renders course MDX/Markdown on the server with the official
// MDX compiler. Content is local (synth_course/); nothing is fetched.
import { evaluate } from "@mdx-js/mdx";
import type { MDXComponents } from "mdx/types";
import * as runtime from "react/jsx-runtime";
import remarkGfm from "remark-gfm";
import rehypePrettyCode from "rehype-pretty-code";

// External links open in a new tab so the course page stays where you were.
const ExternalAwareLink: MDXComponents["a"] = ({ href = "", children, ...rest }) =>
  /^https?:\/\//.test(href) ? (
    <a href={href} target="_blank" rel="noreferrer" {...rest}>
      {children}
    </a>
  ) : (
    <a href={href} {...rest}>
      {children}
    </a>
  );

export async function renderMdx(source: string, components: MDXComponents, format: "md" | "mdx" = "mdx") {
  const { default: Content } = await evaluate(source, {
    ...runtime,
    format,
    remarkPlugins: [remarkGfm],
    rehypePlugins: [[rehypePrettyCode, { theme: { light: "github-light", dark: "github-dark" }, keepBackground: false }]],
  });
  return <Content components={{ a: ExternalAwareLink, ...components }} />;
}

// Wraps the "Compare (spoiler)" section in <Spoiler> so the content files stay
// plain MDX. The section always sits between its heading and "## Stretch".
export function wrapSpoiler(body: string): string {
  return body
    .replace("\n## Compare (spoiler)\n", "\n<Spoiler>\n\n## Compare (spoiler)\n")
    .replace("\n## Stretch\n", "\n</Spoiler>\n\n## Stretch\n");
}
