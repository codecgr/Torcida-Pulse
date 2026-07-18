# Pacote de submissão — World Cup Hackathon Brasil

Formulário inspecionado em modo read-only em 2026-07-18 06:58 BRT:
https://superteam.fun/earn/listing/world-cup-hackathon-brasil

Submeta este formulário **depois** de guardar a confirmação do Consumer global.
O owner de todos os campos e do clique final é o líder humano elegível registrado
em `docs/HUMAN_OWNERSHIP.md`.

## O mesmo conjunto de três URLs

Use exatamente os mesmos três valores de `docs/SUBMISSION_GLOBAL.md`:

- `LIVE_URL`: **[REQUIRED — public HTTPS deployment]**
- `VIDEO_URL`: **[REQUIRED — public/unlisted Loom or YouTube, <= 5:00]**
- `REPO_URL`: **[REQUIRED — public repository]**

## Formulário atual, campo por campo

### 1. Link to Your Submission *

Valor: `LIVE_URL`.

### 2. Tweet Link

Opcional. Deixe vazio se não houver post público já publicado e conferido pelo
owner humano. Não atrase a submissão para criar um tweet.

### 3. Em qual trilha global você submeteu? *

Preencha **somente depois** da confirmação global:

```text
Consumer and Fan Experiences. O mesmo projeto Torcida Pulse foi submetido primeiro à listing global em [BRT TIME] / [UTC TIME], confirmação [GLOBAL CONFIRMATION ID OR URL]. Esta é a segunda metade da dupla submissão obrigatória Global + Brasil.
```

### 4. Link do vídeo demo (até 5 min) *

Valor: `VIDEO_URL`.

### 5. Link do repositório público no GitHub *

Valor: `REPO_URL`.

### 6. Resumo técnico *

```text
Torcida Pulse é um projeto novo, criado especificamente para o World Cup Hackathon 2026. O histórico interno do projeto/harness começa em 17/07/2026 às 20:25 BRT e a linhagem da release pública começa em 18/07 às 02:58 BRT; owner humano e tempo da revisão material final ficam registrados em docs/HUMAN_OWNERSHIP.md.

É uma segunda tela mobile-first PT-BR/EN, sem apostas, para rever uma partida sem spoiler. Um playhead de 20 s revela eventos de placar da TxLINE, pausa na virada factual, compara a mesma tupla StablePrice antes/depois do lance e mostra o estado da validação validateStatV2 na Solana devnet. Não há aposta, custódia, trade, exigência de wallet ou recomendação financeira.

O backend Node faz cinco chamadas reais autenticadas: (1) GET /api/fixtures/snapshot?startEpochDay=20649; (2) GET /api/scores/historical/18241006; (3) GET /api/odds/snapshot/18241006?asOf=<timestamp da virada - 120000 ms>; (4) o mesmo endpoint com <timestamp + 120000 ms>; (5) GET /api/scores/stat-validation?fixtureId=18241006&seq=871&statKeys=1,2. Ele normaliza tudo em um ReplayEnvelope sem expor token, JWT, payload bruto ou proof blob. Deadline total: 12 s; RPC abortável: 3 s; timeout de odds preserva timeline; timeout de prova vira indisponível; após 3 s o usuário pode abrir imediatamente o fallback fictício e rotulado. Um manifesto datado exige rotação antes da janela histórica expirar.

Feedback: autenticação server-side, schema normalizado e .view() devnet funcionaram bem. Fricções: historical veio como SSE finito apesar do exemplo JSON; Score era esparso; campos da tupla de odds podem ser null; simulação read-only precisa de payer público devnet; janela histórica é curta; e a regra de exibição de Data conflita com a exigência de URL testável. A implementação trata cada ponto de forma explícita e não armazena payload bruto.
```

### 7. Nome e handle de todos os membros (máximo 3) *

```text
[REQUIRED — nome do líder humano elegível] — [REQUIRED — @X ou @Telegram]
```

Não use nome do agente como membro. Se houver outros humanos, liste no máximo
três e confirme a elegibilidade individual.

### 8. Anything Else?

```text
CONFIRMAÇÃO EXPLÍCITA DE DUPLA SUBMISSÃO: este é exatamente o mesmo projeto Torcida Pulse já submetido primeiro à trilha global Consumer and Fan Experiences. As duas entradas usam os mesmos LIVE_URL, VIDEO_URL e REPO_URL. Confirmação global: [ID/URL + BRT/UTC]. Projeto novo do hackathon; owner humano: [NOME/HANDLE]; build de 17/07/2026 20:25 BRT até a revisão humana final em [HORÁRIO]. O produto é para fãs e não oferece apostas ou atividade financeira.
```

Substitua os rótulos das três URLs e todos os placeholders humanos/da
confirmação antes de enviar.

### 9. Acknowledgement de KYC Brasil *

Ação exclusivamente humana. Marque somente se o participante puder declarar de
forma verdadeira que aceita a verificação KYC de residência/elegibilidade no
Brasil caso vença.

## Enviar e guardar a segunda confirmação

1. Confirme que a entrada Consumer já consta como enviada.
2. Submeta a listing Brasil até 2026-07-18 23:59 BRT; o formulário mostra custo
   de 1 crédito, então confirme que a conta dispõe dele antes do minuto final.
3. Guarde horário BRT/UTC, ID/URL e screenshot completo em
   `research-harness/records/submissions/private/` (ignorado pelo Git).
4. Calcule o SHA-256 e complete
   `research-harness/records/submissions/CONFIRMATIONS.md` com as duas entradas.
5. Reabra ambas as listings e confirme visualmente que o mesmo projeto aparece
   como submetido; não basta ter clicado no botão.
