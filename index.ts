#!/usr/bin/env node
import { WebSocket } from "ws";
import net from "net";
import { PassThrough } from "stream";

const ERROR_CODE_INVALID_SECRET = 4001;
const ERROR_CODE_ANOTHER_AGENT_CONNECTED = 4002;

function createTunnel(
  tunnelAddress: string,
  tunnelToken: string,
  localHost: string,
  localPort: number
) {
  try {
    console.log(
      "Creating the bridge to",
      localHost,
      localPort,
      "using tunnel room",
      tunnelAddress
    );

    const roomName = new URL(tunnelAddress).pathname.substring(1);

    const ws = new WebSocket(tunnelAddress, {
      headers: { authorization: `Bearer ${tunnelToken}` },
    });
    const duplex = WebSocket.createWebSocketStream(ws);
    const bridge = net.createConnection({ host: localHost, port: localPort });

    const pass1 = new PassThrough();
    pass1.on("data", (r) =>
      console.log("Tunnel > [", roomName, "]", r.length, " bytes received")
    );
    pass1.on("error", console.log);

    const pass2 = new PassThrough();
    pass2.on("data", (r) =>
      console.log("Tunnel > [", roomName, "]", r.length, " bytes sent")
    );
    pass2.on("error", console.log);

    ws.on("close", () => {
      console.log("Tunnel > [", roomName, "]", " Close the pipe");
      duplex.destroy();
      bridge.destroy();
    });

    ws.on("error", () => {
      console.log("Tunnel > [", roomName, "]", " Error on the pipe");
      duplex.destroy();
      bridge.destroy();
    });

    bridge.on("error", () => {
      console.log("Tunnel > [", roomName, "]", " Error on the pipe");
      duplex.destroy();
      bridge.destroy();
    });

    bridge.on("close", () => () => {
      console.log("Tunnel > [", roomName, "]", " Close the pipe");
      duplex.destroy();
      bridge.destroy();
    });

    duplex
      .pipe(pass1)
      .on("error", console.log)
      .pipe(bridge)
      .on("error", console.log);

    bridge
      .pipe(pass2)
      .on("error", console.log)
      .pipe(duplex)
      .on("error", console.log);
  } catch (e) {
    console.log(e);
  }
}

class BridgeServer {
  protected agentEndpoint: string = "";
  protected agentId: string = "";
  protected agentSecret: string = "";
  protected ws?: WebSocket;
  protected reconnectAttempt = 0;
  protected pingInterval?: NodeJS.Timeout;

  constructor(agentEndpoint: string, agentId: string, agentSecret: string) {
    this.agentId = agentId;
    this.agentSecret = agentSecret;
    this.agentEndpoint = agentEndpoint;
    this.connect();
  }

  reconnect() {
    // Cleanup the previous interval
    if (this.pingInterval) clearInterval(this.pingInterval);

    this.reconnectAttempt++;
    const delay = this.reconnectAttempt * 5;
    console.log(`Waiting ${delay} seconds to reconnect`);
    setTimeout(this.connect.bind(this), delay * 1000);
  }

  connect() {
    try {
      console.log("Connecting to bridge server");

      this.ws = new WebSocket(this.agentEndpoint, {
        headers: {
          "x-agent-id": this.agentId,
          "x-agent-secret": this.agentSecret,
        },
      });

      this.ws.on("open", () => {
        console.log("Connection is established");
        this.reconnectAttempt = 0;

        // Ping every 5 seconds
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          if (this.ws) {
            this.ws.ping();
          }
        }, 5000);
      });

      this.ws.on("message", (data) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(data as Buffer));
          createTunnel(msg.tunnelAddress, msg.tunnelToken, msg.host, msg.port);
        } catch (e) {
          console.log("Unexpected error", e);
        }
      });

      this.ws.on("close", (code, message) => {
        if (code === ERROR_CODE_INVALID_SECRET) {
          console.log("ERROR: Invalid credential");
          process.exit(1);
        } else if (code === ERROR_CODE_ANOTHER_AGENT_CONNECTED) {
          console.log("ERROR: Another agent is connected");
          process.exit(1);
        }

        this.reconnect.bind(this)();
      });
      this.ws.on("error", () => {});
    } catch {
      this.reconnect();
    }
  }
}

// Try to get the agent id and secret from arguments
let agentId = "";
let agentSecret = "";
let agentUrl = "https://bridge.outerbase.com/";

const args = process.argv.slice(2);
let argPointerIndex = 0;

while (argPointerIndex < args.length) {
  const currentArgName = args[argPointerIndex];
  argPointerIndex++;

  if (currentArgName === "--id") {
    agentId = args[argPointerIndex];
    argPointerIndex++;
  } else if (currentArgName === "--secret") {
    agentSecret = args[argPointerIndex];
    argPointerIndex++;
  } else if (currentArgName === "--url") {
    agentUrl = args[argPointerIndex];
    argPointerIndex++;
  }
}

agentId = process.env.id ?? agentId;
agentSecret = process.env.secret ?? agentSecret;
agentUrl = process.env.url ?? agentUrl;

new BridgeServer(agentUrl, agentId, agentSecret);
