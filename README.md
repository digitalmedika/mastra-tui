# loccle

Terminal UI for Loccle, powered by [Mastra](https://mastra.ai/) and OpenTUI.

## Usage

Run the TUI:

```shell
bunx loccle
```

The CLI uses `https://api.loccle.com` as its backend by default. Set
`AUTH_SERVER_URL` to override it for local development or staging.

## Development

Start the Mastra development server:

```shell
bun run dev
```

Open [http://localhost:4111](http://localhost:4111) in your browser to access [Mastra Studio](https://mastra.ai/docs/studio/overview). It provides an interactive UI for building and testing your agents, along with a REST API that exposes your Mastra application as a local service. This lets you start building without worrying about integration right away.

Open [http://localhost:4111](http://localhost:4111) in your browser to access Mastra Studio. The development server will automatically reload whenever you make changes.

Run the TUI from the source tree:

```shell
bun run tui
```

Build the Mastra app:

```shell
bun run build
```
