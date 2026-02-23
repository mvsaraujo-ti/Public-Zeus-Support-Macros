🛠 Zeus Support Macros

Extensão desenvolvida para padronização e automação de respostas no ambiente do Interact TJMA.

📌 Sobre o Projeto

O Zeus Support Macros é uma solução voltada para otimizar o atendimento técnico interno, permitindo a criação, organização e utilização de macros personalizadas para respostas rápidas.

O objetivo principal é aumentar a produtividade da equipe, reduzir retrabalho e padronizar a comunicação técnica.

Atualmente o uso é interno no Interact (TJMA), com planejamento de evolução para uma extensão pública do Google Chrome para outras áreas.

🚀 Funcionalidades

Botão flutuante injetado na interface

Painel de macros com busca dinâmica

Filtro por categoria

Sistema de macros fixadas (pinned)

Editor completo de criação e edição

Exclusão segura de macros

Cópia automática para a área de transferência

Exportação de macros em JSON

Importação de macros via arquivo

Backup automático diário

Suporte a variáveis dinâmicas:

{{data}}

{{hora}}

🧠 Arquitetura Técnica

A extensão utiliza o padrão Manifest V3 do Chrome.

Funciona como Content Script, ou seja, um script JavaScript injetado diretamente no DOM da página alvo.

Isso permite:

Manipulação direta da interface

Criação de elementos visuais personalizados

Persistência local de dados via localStorage

Estrutura atual do projeto:

Zeus Support Macros/
├── manifest.json
├── inject.js
├── modal.html
└── assets/

🗄 Persistência de Dados

Os dados são armazenados localmente utilizando localStorage.

Chaves utilizadas:

zeus_macros

zeus_last_backup

Essa abordagem garante funcionamento offline, independência de backend e segurança, pois os dados não saem do ambiente local.

🔒 Escopo Atual

A extensão está configurada para rodar exclusivamente no domínio:

https://interact.tjma.jus.br/
*

Uso interno institucional.

📈 Roadmap

Migrar persistência para chrome.storage

Modularizar a arquitetura do inject.js

Implementar validação de schema para macros

Melhorar UI/UX

Publicar versão oficial como extensão Chrome

🎯 Objetivo

Reduzir tempo de resposta no suporte técnico, melhorar a qualidade dos registros e profissionalizar o processo de atendimento.

👨‍💻 Autor

Maxwell Araújo
Support N2
Desenvolvedor Python
Foco em automação, segurança da informação e melhoria contínua.
