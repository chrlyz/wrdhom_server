## Server for WrdHom: the auditable social-media platform

This repository hosts the code for the server for the [WrdHom](https://github.com/chrlyz/wrdhom_contracts) project.

### Install

```console
npm install
```

### Build

``` console
npm run build
```

### Copy keys and config.json file

Follow the instructions in the [wrdhom_contracts](https://github.com/chrlyz/wrdhom_contracts) repository to generate the `keys` directory and `config.json` file. Then copy them at the top level of your directory for this repository.

### Start server to receive requests

- Create a Postgres database that follows the schema in the `/prisma/schema.prisma` file.
- Set the `DATABASE_URL` variable in your `.env` file.

``` console
npm run service
```

### Start workers to accept requests to generate proofs from prover

- Start a Redis server and indicate `HOST` and `PORT` in your `.env` file.
- You can start any number of workers in different machines and indicate their number in the `PARALLEL_NUMBER` `.env` file.

``` console
npm run workers
```

### Start prover to coordinate generation of proofs in parallel through workers

- Set the `MAX_ATTEMPTS` and `INTERVAL` variables in your `.env` file, to define the behavior when waiting for a transaction to confirm.

``` console
npm run prover
```

### License

[MIT](LICENSE)