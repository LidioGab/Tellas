# 📡 Tellas — Ultra-Low Latency Screen Sharing & Audio Isolation

<p align="center">
  <strong>Plataforma de compartilhamento de tela em tempo real de ultra-baixa latência com isolamento nativo de áudio do Discord e suporte multi-stream.</strong>
</p>

---

## 🚀 Sobre o Projeto

O **Tellas** é uma aplicação desktop e web projetada para transmissão e visualização de telas com altíssima performance, latência sub-segundo via WebRTC e um motor de áudio nativo exclusivo para Windows.

O grande diferencial do Tellas é a sua capacidade de **transmitir o som de jogos, músicas e vídeos do sistema excluindo cirurgicamente a voz de chamadas do Discord**, garantindo privacidade total sem a necessidade de drivers virtuais ou softwares complexos de terceiros.

---

## ✨ Principais Funcionalidades

- 🎧 **Isolamento Nativo de Áudio do Discord (WASAPI Process Loopback)**:
  - Motor nativo em C++ (Node-API) com enumeração de **Windows Core Audio Sessions**.
  - Detecção baseada em evidência multinível (Tiers 1 a 4) da árvore de processos do Discord.
  - Exclusão seletiva no subsistema de renderização de áudio do Windows sem vazamentos.
  - Política de segurança *Fail-Closed* em caso de ambiguidade.
- ⚡ **Transmissão em Ultra-Baixa Latência**:
  - Pipeline WebRTC alimentado por infraestrutura **LiveKit**.
  - Pipeline de áudio em ponto flutuante de 48 kHz stereo com `AudioWorklet`.
- 🖥️ **Multi-Streaming Simultâneo**:
  - Múltiplos participantes podem compartilhar tela na mesma sala ao mesmo tempo.
  - Alternância fluida de transmissões em tempo real.
- 📱 **Interface Moderna & Responsiva**:
  - Aplicativo Desktop em Electron com visual Dark Glassmorphism.
  - Interface Web compatível com Desktop e Mobile (modos Portrait e Landscape com player 16:9 inline).
- 🔒 **Arquitetura Segura & Resiliente**:
  - Servidor de sinalização Fastify com WebSockets (Socket.IO).
  - Geração segura de tokens de sala e controle de ciclo de vida.

---

## 🏗️ Arquitetura do Monorepo

O repositório é estruturado como um monorepo gerenciado por npm workspaces:

```text
Tellas/
├── apps/
│   ├── desktop/          # Aplicação Electron + React + TypeScript + TailwindCSS
│   └── backend/          # Servidor Fastify + Socket.IO + LiveKit Server SDK
├── packages/
│   ├── native-audio/     # Addon nativo C++ (WASAPI Loopback & Core Audio Sessions)
│   └── shared/           # Contratos, tipos TypeScript e constantes compartilhadas
```

---

## 🛠️ Tecnologias Utilizadas

- **Frontend & Desktop:** Electron, React 18, TypeScript, TailwindCSS, Vite, Lucide Icons
- **Backend & Sinalização:** Node.js, Fastify, Socket.IO, LiveKit Server SDK
- **Motor de Áudio Nativo:** C++17, Node-API (`node-addon-api`), Windows Core Audio APIs (WASAPI, `IMMDeviceEnumerator`, `IAudioSessionManager2`)
- **Transmissão WebRTC:** LiveKit Client SDK, Web Audio API (`AudioWorkletNode`)

---

## 📋 Pré-requisitos

- **Node.js**: Versão 20+ recomendada
- **npm**: Versão 10+
- **Compilador C++ (para o addon nativo no Windows)**: Visual Studio Build Tools (com C++ Desktop Development) ou Visual Studio 2022+ Community

---

## ⚙️ Instalação e Execução

### 1. Clonar o Repositório
```bash
git clone https://github.com/LidioGab/Tellas.git
cd Tellas
```

### 2. Instalar Dependências
```bash
npm install
```

### 3. Compilar o Addon Nativo
```bash
npm run build:native
```

### 4. Executar em Desenvolvimento

**Backend:**
```bash
npm run dev:backend
```

**Desktop (Electron):**
```bash
npm run dev:desktop
```

---

## 📦 Build e Empacotamento

Para gerar os binários de produção do aplicativo desktop para Windows (`.exe` descompactado e instalador):

```bash
# 1. Compilar pacotes compartilhados e renderer
npm run build:shared
npm run build:renderer --workspace=apps/desktop
npm run build:electron --workspace=apps/desktop

# 2. Empacotar distribuição Windows
npm run package:desktop
```

Os executáveis gerados estarão disponíveis em:
```text
apps/desktop/release/win-unpacked/Tellas.exe
```

---

## 📄 Licença

Este projeto é desenvolvido para uso privado e comercial sob os termos definidos pelos mantenedores.
