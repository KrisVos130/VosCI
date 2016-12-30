FROM node

RUN apt-get update

RUN mkdir -p /opt
RUN mkdir -p /opt/container

WORKDIR /opt
ADD package.json /opt/package.json

RUN npm install

CMD npm run start